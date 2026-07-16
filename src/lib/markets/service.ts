import { buildMarketsResponse, type MarketsResponse } from './contract';
import {
  getMarketsDatabase,
  type MarketsDatabase,
  type MarketsDatabaseSnapshot,
} from './database-source';

type Environment = Readonly<Record<string, string | undefined>>;

export type MarketsDataMode = 'live' | 'database' | 'database_with_live_fallback';
export type MarketsDataSource = 'live' | 'worldstate-database' | 'live-fallback';
export type MarketsFallbackReason =
  | 'database-unconfigured'
  | 'database-unavailable'
  | 'database-without-success'
  | 'database-stale';

export interface MarketsRuntimeConfig {
  mode: MarketsDataMode;
  databaseMaxAgeMs: number;
  databaseWindowMs: number;
}

export interface MarketsSnapshot {
  response: MarketsResponse;
  mode: MarketsDataMode;
  source: MarketsDataSource;
  databaseResponseReceivedAt: Date | null;
  databaseUpstreamTimestamp: Date | null;
  databaseStale: boolean;
  fallbackReason: MarketsFallbackReason | null;
}

interface MarketsServiceDependencies {
  getDatabase?: () => MarketsDatabase | null;
  loadLive: () => Promise<MarketsResponse>;
  now?: () => Date;
  warn?: (message: string) => void;
}

export class MarketsDatabaseUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MarketsDatabaseUnavailableError';
  }
}

function readDuration(
  environment: Environment,
  name: string,
  fallback: number,
): number {
  const value = environment[name];
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 60_000 || parsed > 86_400_000) {
    throw new Error(`${name} must be an integer between 60000 and 86400000`);
  }
  return parsed;
}

export function loadMarketsRuntimeConfig(
  environment: Environment = process.env,
): MarketsRuntimeConfig {
  const value = environment.MARKETS_DATA_MODE?.trim() || 'live';
  if (value !== 'live' && value !== 'database' && value !== 'database_with_live_fallback') {
    throw new Error('MARKETS_DATA_MODE must be live, database, or database_with_live_fallback');
  }

  return {
    mode: value,
    databaseMaxAgeMs: value === 'live'
      ? 900_000
      : readDuration(environment, 'MARKETS_DATABASE_MAX_AGE_MS', 900_000),
    databaseWindowMs: readDuration(environment, 'MARKETS_DATABASE_WINDOW_MS', 900_000),
  };
}

function databaseAge(snapshot: MarketsDatabaseSnapshot, now: Date): number | null {
  if (snapshot.responseReceivedAt === null || snapshot.upstreamTimestamp === null) return null;
  return Math.max(
    0,
    now.getTime() - snapshot.responseReceivedAt.getTime(),
    now.getTime() - snapshot.upstreamTimestamp.getTime(),
  );
}

async function liveSnapshot(
  config: MarketsRuntimeConfig,
  loadLive: () => Promise<MarketsResponse>,
  fallbackReason: MarketsFallbackReason | null,
  databaseResponseReceivedAt: Date | null = null,
  databaseUpstreamTimestamp: Date | null = null,
): Promise<MarketsSnapshot> {
  const response = await loadLive();
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

export async function loadMarketsSnapshot(
  config: MarketsRuntimeConfig,
  dependencies: MarketsServiceDependencies,
): Promise<MarketsSnapshot> {
  const now = dependencies.now?.() ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new TypeError('Current time must be a valid date');

  if (config.mode === 'live') {
    return liveSnapshot(config, dependencies.loadLive, null);
  }

  const getDatabase = dependencies.getDatabase ?? (() => getMarketsDatabase());
  let database: MarketsDatabase | null;
  try {
    database = getDatabase();
  } catch (error) {
    if (config.mode === 'database_with_live_fallback') {
      dependencies.warn?.('[markets] Database configuration failed; using live fallback');
      return liveSnapshot(config, dependencies.loadLive, 'database-unavailable');
    }
    throw new MarketsDatabaseUnavailableError('Markets database configuration is invalid', { cause: error });
  }

  if (database === null) {
    if (config.mode === 'database_with_live_fallback') {
      dependencies.warn?.('[markets] Database is unconfigured; using live fallback');
      return liveSnapshot(config, dependencies.loadLive, 'database-unconfigured');
    }
    throw new MarketsDatabaseUnavailableError('Markets database is not configured');
  }

  let databaseSnapshot: MarketsDatabaseSnapshot;
  try {
    databaseSnapshot = await database.loadSnapshot(config.databaseWindowMs);
  } catch (error) {
    if (config.mode === 'database_with_live_fallback') {
      dependencies.warn?.('[markets] Database query failed; using live fallback');
      return liveSnapshot(config, dependencies.loadLive, 'database-unavailable');
    }
    throw new MarketsDatabaseUnavailableError('Markets database query failed', { cause: error });
  }

  const age = databaseAge(databaseSnapshot, now);
  if (age === null) {
    if (config.mode === 'database_with_live_fallback') {
      dependencies.warn?.('[markets] Database has no successful market snapshot; using live fallback');
      return liveSnapshot(config, dependencies.loadLive, 'database-without-success');
    }
    throw new MarketsDatabaseUnavailableError('Markets database has no successful collection');
  }

  const stale = age > config.databaseMaxAgeMs;
  if (stale && config.mode === 'database_with_live_fallback') {
    dependencies.warn?.('[markets] Database snapshot is stale; using live fallback');
    return liveSnapshot(
      config,
      dependencies.loadLive,
      'database-stale',
      databaseSnapshot.responseReceivedAt,
      databaseSnapshot.upstreamTimestamp,
    );
  }

  if (stale) {
    throw new MarketsDatabaseUnavailableError('Markets database snapshot is stale');
  }

  return {
    response: buildMarketsResponse(databaseSnapshot.observations, now),
    mode: config.mode,
    source: 'worldstate-database',
    databaseResponseReceivedAt: databaseSnapshot.responseReceivedAt,
    databaseUpstreamTimestamp: databaseSnapshot.upstreamTimestamp,
    databaseStale: false,
    fallbackReason: null,
  };
}
