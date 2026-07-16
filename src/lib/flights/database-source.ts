import { Pool, type PoolConfig, type QueryResultRow } from 'pg';

import type { Flight, GpsJammingCell } from './contract';

type Environment = Readonly<Record<string, string | undefined>>;

const AVIATION_SOURCE_IDS = ['airplanes-live-military', 'adsb-lol-military'] as const;
const JAMMING_NACAP_THRESHOLD = 4;

const DATABASE_QUERY = `
WITH latest_success AS (
  SELECT
    MAX(response_received_at) AS response_received_at,
    MAX(upstream_timestamp) AS upstream_timestamp
  FROM collection_runs
  WHERE source_id = ANY($1::text[])
    AND status = 'succeeded'
    AND legacy_provenance_incomplete = FALSE
    AND response_received_at IS NOT NULL
)
SELECT
  latest_success.response_received_at,
  latest_success.upstream_timestamp,
  aircraft.source_id,
  aircraft.source_aircraft_id,
  aircraft.icao24,
  aircraft.callsign,
  aircraft.registration,
  aircraft.aircraft_type,
  aircraft.altitude_meters,
  aircraft.speed_knots,
  aircraft.heading,
  aircraft.squawk,
  aircraft.nac_p,
  aircraft.military_flag,
  ST_Y(aircraft.geometry)::double precision AS latitude,
  ST_X(aircraft.geometry)::double precision AS longitude,
  aircraft.updated_at
FROM latest_success
LEFT JOIN aircraft_position_observations AS aircraft
  ON aircraft.source_id = ANY($1::text[])
 AND aircraft.updated_at >= latest_success.response_received_at - ($2::text)::interval
ORDER BY aircraft.updated_at DESC NULLS LAST, aircraft.source_id ASC, aircraft.source_aircraft_id ASC
LIMIT 10000`;

interface DatabaseFlightRow extends QueryResultRow {
  response_received_at: Date | string | null;
  upstream_timestamp: Date | string | null;
  source_id: string | null;
  source_aircraft_id: string | null;
  icao24: string | null;
  callsign: string | null;
  registration: string | null;
  aircraft_type: string | null;
  altitude_meters: number | null;
  speed_knots: number | null;
  heading: number | null;
  squawk: string | null;
  nac_p: number | null;
  military_flag: boolean | null;
  latitude: number | null;
  longitude: number | null;
}

export interface FlightDatabaseSnapshot {
  flights: Flight[];
  gpsJamming: GpsJammingCell[];
  responseReceivedAt: Date | null;
  upstreamTimestamp: Date | null;
}

export interface FlightDatabase {
  loadSnapshot(windowMs: number): Promise<FlightDatabaseSnapshot>;
}

export interface FlightQueryExecutor {
  query<Row extends QueryResultRow>(
    queryText: string,
    values: unknown[],
  ): Promise<{ rows: Row[] }>;
}

export class FlightDatabaseDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlightDatabaseDataError';
  }
}

function environmentValue(environment: Environment, name: string): string | undefined {
  const value = environment[name]?.trim();
  return value === '' ? undefined : value;
}

function environmentSecret(environment: Environment, name: string): string | undefined {
  const value = environment[name];
  return value === undefined || value === '' ? undefined : value;
}

function environmentDuration(
  environment: Environment,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = environmentValue(environment, name);
  if (value === undefined) return fallback;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function validateDatabaseUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error('DATABASE_URL must be an absolute PostgreSQL URL', { cause: error });
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL must use the postgres or postgresql protocol');
  }
  if (!url.hostname || url.pathname.length <= 1 || !url.username || !url.password) {
    throw new Error('DATABASE_URL must include a host, database, username, and password');
  }
}

function parseTimestamp(value: Date | string | null | undefined, field: string): Date | null {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new FlightDatabaseDataError(`Database returned an invalid ${field} timestamp`);
  }
  return parsed;
}

function finiteNumber(value: number | null, field: string, aircraftId: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new FlightDatabaseDataError(`Database returned invalid ${field} for ${aircraftId}`);
  }
  return value;
}

function nullableFiniteNumber(value: number | null, field: string, aircraftId: string): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value)) {
    throw new FlightDatabaseDataError(`Database returned invalid ${field} for ${aircraftId}`);
  }
  return value;
}

function mapDatabaseRow(row: DatabaseFlightRow): Flight | null {
  if (row.source_aircraft_id === null) return null;
  const aircraftId = row.source_aircraft_id;
  const lat = finiteNumber(row.latitude, 'latitude', aircraftId);
  const lng = finiteNumber(row.longitude, 'longitude', aircraftId);
  const altitudeMeters = nullableFiniteNumber(row.altitude_meters, 'altitude', aircraftId);
  const heading = nullableFiniteNumber(row.heading, 'heading', aircraftId);
  const speedKnots = nullableFiniteNumber(row.speed_knots, 'speed', aircraftId);
  const nacP = row.nac_p === null ? null : finiteNumber(row.nac_p, 'nac_p', aircraftId);
  const model = row.aircraft_type ?? 'Unknown';

  return {
    callsign: row.callsign ?? row.icao24 ?? aircraftId,
    lat: Math.round(lat * 100000) / 100000,
    lng: Math.round(lng * 100000) / 100000,
    alt: altitudeMeters === null ? 0 : Math.round(altitudeMeters),
    heading: heading === null ? 0 : Math.round(heading),
    speed_knots: speedKnots,
    model,
    icao24: row.icao24 ?? aircraftId,
    registration: row.registration ?? 'N/A',
    squawk: row.squawk ?? '',
    airline_code: '',
    aircraft_category: model.toUpperCase().startsWith('UH') ? 'heli' : 'plane',
    category: row.military_flag === false ? 'commercial' : 'military',
    grounded: altitudeMeters !== null && altitudeMeters < 30,
    nac_p: nacP,
    type: 'flight',
  };
}

function aggregateJamming(flights: Flight[]): GpsJammingCell[] {
  const grid = new Map<string, { lat: number; lng: number; count: number; total_nac_p: number }>();
  const gridSize = 2;

  for (const flight of flights) {
    if (typeof flight.nac_p !== 'number' || flight.nac_p > JAMMING_NACAP_THRESHOLD || flight.grounded) {
      continue;
    }
    const gLat = Math.floor(flight.lat / gridSize) * gridSize;
    const gLng = Math.floor(flight.lng / gridSize) * gridSize;
    const key = `${gLat},${gLng}`;
    const existing = grid.get(key) ?? { lat: gLat + gridSize / 2, lng: gLng + gridSize / 2, count: 0, total_nac_p: 0 };
    existing.count += 1;
    existing.total_nac_p += flight.nac_p;
    grid.set(key, existing);
  }

  return Array.from(grid.values())
    .filter((cell) => cell.count >= 3)
    .map((cell) => ({
      lat: cell.lat,
      lng: cell.lng,
      severity: Math.round((1 - (cell.total_nac_p / cell.count) / JAMMING_NACAP_THRESHOLD) * 100),
      count: cell.count,
    }));
}

export class PostgresFlightDatabase implements FlightDatabase {
  constructor(private readonly executor: FlightQueryExecutor) {}

  async loadSnapshot(windowMs: number): Promise<FlightDatabaseSnapshot> {
    if (!Number.isSafeInteger(windowMs) || windowMs < 60_000 || windowMs > 86_400_000) {
      throw new Error('Flight database window must be between 60000 and 86400000 milliseconds');
    }

    const result = await this.executor.query<DatabaseFlightRow>(DATABASE_QUERY, [
      [...AVIATION_SOURCE_IDS],
      `${windowMs} milliseconds`,
    ]);
    const responseReceivedAt = parseTimestamp(result.rows[0]?.response_received_at, 'response-received');
    const upstreamTimestamp = parseTimestamp(result.rows[0]?.upstream_timestamp, 'upstream');
    const flights = result.rows.flatMap((row) => {
      const mapped = mapDatabaseRow(row);
      return mapped === null ? [] : [mapped];
    });

    return {
      flights,
      gpsJamming: aggregateJamming(flights),
      responseReceivedAt,
      upstreamTimestamp,
    };
  }
}

export function resolveFlightPoolConfig(environment: Environment = process.env): PoolConfig | null {
  const discrete = {
    database: environmentValue(environment, 'WORLDSTATE_PGDATABASE'),
    host: environmentValue(environment, 'WORLDSTATE_PGHOST'),
    password: environmentSecret(environment, 'WORLDSTATE_PGPASSWORD'),
    port: environmentValue(environment, 'WORLDSTATE_PGPORT'),
    user: environmentValue(environment, 'WORLDSTATE_PGUSER'),
  };
  const discreteValues = Object.values(discrete);
  const hasCompleteDiscreteConfig = discreteValues.every((value) => value !== undefined);
  const hasPartialDiscreteConfig = discreteValues.some((value) => value !== undefined);
  const common: PoolConfig = {
    application_name: 'osiris-flights-api',
    connectionTimeoutMillis: environmentDuration(environment, 'DB_CONNECTION_TIMEOUT_MS', 5_000, 250, 60_000),
    idleTimeoutMillis: 30_000,
    lock_timeout: environmentDuration(environment, 'DB_LOCK_TIMEOUT_MS', 5_000, 250, 60_000),
    max: 5,
    query_timeout: environmentDuration(environment, 'DB_QUERY_TIMEOUT_MS', 15_000, 250, 120_000),
    statement_timeout: environmentDuration(environment, 'DB_STATEMENT_TIMEOUT_MS', 15_000, 250, 120_000),
  };

  if (hasCompleteDiscreteConfig) {
    const port = Number(discrete.port);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error('WORLDSTATE_PGPORT must be an integer between 1 and 65535');
    }
    return { ...common, database: discrete.database, host: discrete.host, password: discrete.password, port, user: discrete.user };
  }

  const databaseUrl = environmentValue(environment, 'DATABASE_URL');
  if (databaseUrl !== undefined) {
    validateDatabaseUrl(databaseUrl);
    return { ...common, connectionString: databaseUrl };
  }

  if (hasPartialDiscreteConfig) {
    const missing = Object.entries(discrete)
      .filter(([, value]) => value === undefined)
      .map(([name]) => `WORLDSTATE_PG${name.toUpperCase()}`);
    throw new Error(`Incomplete World-State database settings; missing: ${missing.join(', ')}`);
  }

  return null;
}

type FlightGlobal = typeof globalThis & {
  __osirisFlightPool?: Pool;
  __osirisFlightDatabase?: PostgresFlightDatabase;
};

export function getFlightDatabase(environment: Environment = process.env): FlightDatabase | null {
  const config = resolveFlightPoolConfig(environment);
  if (config === null) return null;

  const shared = globalThis as FlightGlobal;
  if (shared.__osirisFlightDatabase !== undefined) return shared.__osirisFlightDatabase;

  const pool = new Pool(config);
  pool.on('error', (error) => {
    console.error('[flights] Idle database client error:', error.message);
  });
  const database = new PostgresFlightDatabase(pool);
  shared.__osirisFlightPool = pool;
  shared.__osirisFlightDatabase = database;
  return database;
}
