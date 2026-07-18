type Environment = Readonly<Record<string, string | undefined>>;

export type PersistedDataMode = 'live' | 'database' | 'database_with_live_fallback';
export type PersistedDataSource = 'live' | 'worldstate-database' | 'live-fallback';
export type PersistedFallbackReason =
  | 'database-unconfigured'
  | 'database-unavailable'
  | 'database-without-success'
  | 'database-stale';

export interface PersistedRuntimeConfig {
  mode: PersistedDataMode;
  databaseMaxAgeMs: number;
  databaseWindowMs: number;
}

export interface PersistedDatabaseResult<Rows> {
  rows: Rows;
  responseReceivedAt: Date | null;
  upstreamTimestamp: Date | null;
}

export interface PersistedSnapshot<Response> {
  response: Response;
  mode: PersistedDataMode;
  source: PersistedDataSource;
  databaseResponseReceivedAt: Date | null;
  databaseUpstreamTimestamp: Date | null;
  databaseStale: boolean;
  fallbackReason: PersistedFallbackReason | null;
}

export interface PersistedServiceDependencies<Response, Rows> {
  /** Feed label used in warning log prefixes, e.g. "news". */
  label: string;
  /** Returns null when the World-State database is unconfigured; may throw on invalid settings. */
  getDatabaseResult: (windowMs: number) => Promise<PersistedDatabaseResult<Rows> | null> | PersistedDatabaseResult<Rows> | null;
  buildDatabaseResponse: (rows: Rows, now: Date) => Response;
  loadLive: () => Promise<Response>;
  now?: () => Date;
  warn?: (message: string) => void;
}

export class PersistedDatabaseUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PersistedDatabaseUnavailableError';
  }
}

function readDuration(environment: Environment, name: string, fallback: number): number {
  const value = environment[name];
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 60_000 || parsed > 86_400_000) {
    throw new Error(`${name} must be an integer between 60000 and 86400000`);
  }
  return parsed;
}

/**
 * Read `${prefix}_DATA_MODE`, `${prefix}_DATABASE_MAX_AGE_MS` and
 * `${prefix}_DATABASE_WINDOW_MS`, mirroring the earthquakes/flights/markets
 * runtime configuration contract. `live` stays the backward-compatible default
 * and never opens a database connection.
 */
export function loadPersistedRuntimeConfig(
  prefix: string,
  environment: Environment = process.env,
  defaultWindowMs = 900_000,
): PersistedRuntimeConfig {
  const name = `${prefix}_DATA_MODE`;
  const value = environment[name]?.trim() || 'live';
  if (value !== 'live' && value !== 'database' && value !== 'database_with_live_fallback') {
    throw new Error(`${name} must be live, database, or database_with_live_fallback`);
  }

  return {
    mode: value,
    databaseMaxAgeMs: value === 'live'
      ? 900_000
      : readDuration(environment, `${prefix}_DATABASE_MAX_AGE_MS`, 900_000),
    databaseWindowMs: readDuration(environment, `${prefix}_DATABASE_WINDOW_MS`, defaultWindowMs),
  };
}

function databaseAge(result: PersistedDatabaseResult<unknown>, now: Date): number | null {
  if (result.responseReceivedAt === null) return null;
  return Math.max(
    0,
    now.getTime() - result.responseReceivedAt.getTime(),
    result.upstreamTimestamp === null ? 0 : now.getTime() - result.upstreamTimestamp.getTime(),
  );
}

async function liveSnapshot<Response, Rows>(
  config: PersistedRuntimeConfig,
  dependencies: PersistedServiceDependencies<Response, Rows>,
  fallbackReason: PersistedFallbackReason | null,
  databaseResponseReceivedAt: Date | null = null,
  databaseUpstreamTimestamp: Date | null = null,
): Promise<PersistedSnapshot<Response>> {
  const response = await dependencies.loadLive();
  return {
    response,
    mode: config.mode,
    source: fallbackReason === null ? 'live' : 'live-fallback',
    databaseResponseReceivedAt,
    databaseUpstreamTimestamp,
    databaseStale: fallbackReason === 'database-stale',
    fallbackReason,
  };
}

/**
 * Generic live/database/database_with_live_fallback selection used by the
 * persisted feed routes. Semantics mirror the markets service: hard failures
 * in `database` mode raise PersistedDatabaseUnavailableError, while
 * `database_with_live_fallback` logs a sanitised reason and falls back live.
 * Age is measured from the latest successful collection's response-received
 * timestamp and, when the provider supplied one, the upstream timestamp.
 */
export async function loadPersistedSnapshot<Response, Rows>(
  config: PersistedRuntimeConfig,
  dependencies: PersistedServiceDependencies<Response, Rows>,
): Promise<PersistedSnapshot<Response>> {
  const now = dependencies.now?.() ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new TypeError('Current time must be a valid date');

  if (config.mode === 'live') {
    return liveSnapshot(config, dependencies, null);
  }

  const label = dependencies.label;
  let result: PersistedDatabaseResult<Rows> | null;
  try {
    result = await dependencies.getDatabaseResult(config.databaseWindowMs);
  } catch (error) {
    if (config.mode === 'database_with_live_fallback') {
      dependencies.warn?.(`[${label}] Database unavailable; using live fallback`);
      return liveSnapshot(config, dependencies, 'database-unavailable');
    }
    throw new PersistedDatabaseUnavailableError(`${label} database is unavailable`, { cause: error });
  }

  if (result === null) {
    if (config.mode === 'database_with_live_fallback') {
      dependencies.warn?.(`[${label}] Database is unconfigured; using live fallback`);
      return liveSnapshot(config, dependencies, 'database-unconfigured');
    }
    throw new PersistedDatabaseUnavailableError(`${label} database is not configured`);
  }

  const age = databaseAge(result, now);
  if (age === null) {
    if (config.mode === 'database_with_live_fallback') {
      dependencies.warn?.(`[${label}] Database has no successful collection; using live fallback`);
      return liveSnapshot(config, dependencies, 'database-without-success');
    }
    throw new PersistedDatabaseUnavailableError(`${label} database has no successful collection`);
  }

  const stale = age > config.databaseMaxAgeMs;
  if (stale && config.mode === 'database_with_live_fallback') {
    dependencies.warn?.(`[${label}] Database snapshot is stale; using live fallback`);
    return liveSnapshot(
      config,
      dependencies,
      'database-stale',
      result.responseReceivedAt,
      result.upstreamTimestamp,
    );
  }

  if (stale) {
    throw new PersistedDatabaseUnavailableError(`${label} database snapshot is stale`);
  }

  return {
    response: dependencies.buildDatabaseResponse(result.rows, now),
    mode: config.mode,
    source: 'worldstate-database',
    databaseResponseReceivedAt: result.responseReceivedAt,
    databaseUpstreamTimestamp: result.upstreamTimestamp,
    databaseStale: false,
    fallbackReason: null,
  };
}

/**
 * Diagnostic response headers matching the earthquakes/flights/markets routes:
 * mode/source selection, database timestamps, staleness and fallback reason,
 * without exposing connection details.
 */
export function persistedResponseHeaders(
  headerLabel: string,
  snapshot: PersistedSnapshot<unknown>,
  cacheControl: string,
): Record<string, string> {
  return {
    'Cache-Control': cacheControl,
    [`X-OSIRIS-${headerLabel}-Mode`]: snapshot.mode,
    [`X-OSIRIS-${headerLabel}-Source`]: snapshot.source,
    ...(snapshot.databaseResponseReceivedAt === null
      ? {}
      : { 'X-OSIRIS-Database-Response-Received': snapshot.databaseResponseReceivedAt.toISOString() }),
    ...(snapshot.databaseUpstreamTimestamp === null
      ? {}
      : { 'X-OSIRIS-Database-Upstream-Timestamp': snapshot.databaseUpstreamTimestamp.toISOString() }),
    ...(snapshot.databaseStale ? { 'X-OSIRIS-Database-Stale': 'true' } : {}),
    ...(snapshot.fallbackReason === null
      ? {}
      : { [`X-OSIRIS-${headerLabel}-Fallback`]: snapshot.fallbackReason }),
  };
}
