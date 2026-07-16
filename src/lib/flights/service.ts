import { buildFlightResponse, type FlightResponse } from './contract';
import {
  getFlightDatabase,
  type FlightDatabase,
  type FlightDatabaseSnapshot,
} from './database-source';

type Environment = Readonly<Record<string, string | undefined>>;

export type FlightDataMode = 'live' | 'database' | 'database_with_live_fallback';
export type FlightDataSource = 'live' | 'worldstate-database' | 'live-fallback';
export type FlightFallbackReason =
  | 'database-unconfigured'
  | 'database-unavailable'
  | 'database-without-success'
  | 'database-stale';

export interface FlightRuntimeConfig {
  mode: FlightDataMode;
  databaseMaxAgeMs: number;
  databaseWindowMs: number;
}

export interface FlightSnapshot {
  response: FlightResponse;
  mode: FlightDataMode;
  source: FlightDataSource;
  databaseResponseReceivedAt: Date | null;
  databaseUpstreamTimestamp: Date | null;
  databaseStale: boolean;
  fallbackReason: FlightFallbackReason | null;
}

interface FlightServiceDependencies {
  getDatabase?: () => FlightDatabase | null;
  loadLive: () => Promise<FlightResponse>;
  now?: () => Date;
  warn?: (message: string) => void;
}

export class FlightDatabaseUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'FlightDatabaseUnavailableError';
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

export function loadFlightRuntimeConfig(
  environment: Environment = process.env,
): FlightRuntimeConfig {
  const value = environment.FLIGHTS_DATA_MODE?.trim() || 'live';
  if (value !== 'live' && value !== 'database' && value !== 'database_with_live_fallback') {
    throw new Error('FLIGHTS_DATA_MODE must be live, database, or database_with_live_fallback');
  }

  return {
    mode: value,
    databaseMaxAgeMs: value === 'live'
      ? 900_000
      : readDuration(environment, 'FLIGHTS_DATABASE_MAX_AGE_MS', 900_000),
    databaseWindowMs: readDuration(environment, 'FLIGHTS_DATABASE_WINDOW_MS', 900_000),
  };
}

function databaseAge(snapshot: FlightDatabaseSnapshot, now: Date): number | null {
  if (snapshot.responseReceivedAt === null || snapshot.upstreamTimestamp === null) return null;
  return Math.max(
    0,
    now.getTime() - snapshot.responseReceivedAt.getTime(),
    now.getTime() - snapshot.upstreamTimestamp.getTime(),
  );
}

async function liveSnapshot(
  config: FlightRuntimeConfig,
  loadLive: () => Promise<FlightResponse>,
  fallbackReason: FlightFallbackReason | null,
  databaseResponseReceivedAt: Date | null = null,
  databaseUpstreamTimestamp: Date | null = null,
): Promise<FlightSnapshot> {
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

export async function loadFlightSnapshot(
  config: FlightRuntimeConfig,
  dependencies: FlightServiceDependencies,
): Promise<FlightSnapshot> {
  const now = dependencies.now?.() ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new TypeError('Current time must be a valid date');

  if (config.mode === 'live') {
    return liveSnapshot(config, dependencies.loadLive, null);
  }

  const getDatabase = dependencies.getDatabase ?? (() => getFlightDatabase());
  let database: FlightDatabase | null;
  try {
    database = getDatabase();
  } catch (error) {
    if (config.mode === 'database_with_live_fallback') {
      dependencies.warn?.('[flights] Database configuration failed; using live fallback');
      return liveSnapshot(config, dependencies.loadLive, 'database-unavailable');
    }
    throw new FlightDatabaseUnavailableError('Flight database configuration is invalid', { cause: error });
  }

  if (database === null) {
    if (config.mode === 'database_with_live_fallback') {
      dependencies.warn?.('[flights] Database is unconfigured; using live fallback');
      return liveSnapshot(config, dependencies.loadLive, 'database-unconfigured');
    }
    throw new FlightDatabaseUnavailableError('Flight database is not configured');
  }

  let databaseSnapshot: FlightDatabaseSnapshot;
  try {
    databaseSnapshot = await database.loadSnapshot(config.databaseWindowMs);
  } catch (error) {
    if (config.mode === 'database_with_live_fallback') {
      dependencies.warn?.('[flights] Database query failed; using live fallback');
      return liveSnapshot(config, dependencies.loadLive, 'database-unavailable');
    }
    throw new FlightDatabaseUnavailableError('Flight database query failed', { cause: error });
  }

  const age = databaseAge(databaseSnapshot, now);
  if (age === null) {
    if (config.mode === 'database_with_live_fallback') {
      dependencies.warn?.('[flights] Database has no successful aviation snapshot; using live fallback');
      return liveSnapshot(config, dependencies.loadLive, 'database-without-success');
    }
    throw new FlightDatabaseUnavailableError('Flight database has no successful collection');
  }

  const stale = age > config.databaseMaxAgeMs;
  if (stale && config.mode === 'database_with_live_fallback') {
    dependencies.warn?.('[flights] Database snapshot is stale; using live fallback');
    return liveSnapshot(
      config,
      dependencies.loadLive,
      'database-stale',
      databaseSnapshot.responseReceivedAt,
      databaseSnapshot.upstreamTimestamp,
    );
  }

  if (stale) {
    throw new FlightDatabaseUnavailableError('Flight database snapshot is stale');
  }

  return {
    response: buildFlightResponse(
      databaseSnapshot.flights,
      databaseSnapshot.gpsJamming,
      'worldstate-database',
      now,
    ),
    mode: config.mode,
    source: 'worldstate-database',
    databaseResponseReceivedAt: databaseSnapshot.responseReceivedAt,
    databaseUpstreamTimestamp: databaseSnapshot.upstreamTimestamp,
    databaseStale: false,
    fallbackReason: null,
  };
}
