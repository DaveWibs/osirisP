import { Pool, type PoolConfig, type QueryResultRow } from 'pg';

import type { MarketObservation } from './contract';

type Environment = Readonly<Record<string, string | undefined>>;

const MARKET_SOURCE_ID = 'yahoo-finance-market-quotes';

const DATABASE_QUERY = `
WITH latest_success AS (
  SELECT
    response_received_at,
    upstream_timestamp
  FROM collection_runs
  WHERE source_id = $1
    AND status = 'succeeded'
    AND legacy_provenance_incomplete = FALSE
    AND response_received_at IS NOT NULL
  ORDER BY response_received_at DESC, id DESC
  LIMIT 1
)
SELECT
  latest_success.response_received_at,
  latest_success.upstream_timestamp,
  quote.symbol,
  quote.display_name,
  quote.price,
  quote.change_percent,
  quote.up,
  quote.updated_at
FROM latest_success
LEFT JOIN market_quote_observations AS quote
  ON quote.source_id = $1
 AND quote.updated_at >= latest_success.response_received_at - ($2::text)::interval
ORDER BY quote.updated_at DESC NULLS LAST, quote.symbol ASC`;

interface MarketQuoteRow extends QueryResultRow {
  response_received_at: Date | string | null;
  upstream_timestamp: Date | string | null;
  symbol: string | null;
  display_name: string | null;
  price: number | null;
  change_percent: number | null;
  up: boolean | null;
}

export interface MarketsDatabaseSnapshot {
  observations: MarketObservation[];
  responseReceivedAt: Date | null;
  upstreamTimestamp: Date | null;
}

export interface MarketsDatabase {
  loadSnapshot(windowMs: number): Promise<MarketsDatabaseSnapshot>;
}

export interface MarketsQueryExecutor {
  query<Row extends QueryResultRow>(
    queryText: string,
    values: unknown[],
  ): Promise<{ rows: Row[] }>;
}

export class MarketsDatabaseDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MarketsDatabaseDataError';
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
    throw new MarketsDatabaseDataError(`Database returned an invalid ${field} timestamp`);
  }
  return parsed;
}

function finiteNumber(value: number | null, field: string, symbol: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new MarketsDatabaseDataError(`Database returned invalid ${field} for ${symbol}`);
  }
  return value;
}

function mapRow(row: MarketQuoteRow): MarketObservation | null {
  if (row.symbol === null) return null;
  if (row.display_name === null || row.up === null) {
    throw new MarketsDatabaseDataError(`Database returned incomplete quote for ${row.symbol}`);
  }

  return {
    symbol: row.symbol,
    displayName: row.display_name,
    price: finiteNumber(row.price, 'price', row.symbol),
    changePercent: finiteNumber(row.change_percent, 'change_percent', row.symbol),
    up: row.up,
  };
}

export class PostgresMarketsDatabase implements MarketsDatabase {
  constructor(private readonly executor: MarketsQueryExecutor) {}

  async loadSnapshot(windowMs: number): Promise<MarketsDatabaseSnapshot> {
    if (!Number.isSafeInteger(windowMs) || windowMs < 60_000 || windowMs > 86_400_000) {
      throw new Error('Markets database window must be between 60000 and 86400000 milliseconds');
    }

    const result = await this.executor.query<MarketQuoteRow>(DATABASE_QUERY, [
      MARKET_SOURCE_ID,
      `${windowMs} milliseconds`,
    ]);
    return {
      observations: result.rows.flatMap((row) => {
        const mapped = mapRow(row);
        return mapped === null ? [] : [mapped];
      }),
      responseReceivedAt: parseTimestamp(result.rows[0]?.response_received_at, 'response-received'),
      upstreamTimestamp: parseTimestamp(result.rows[0]?.upstream_timestamp, 'upstream'),
    };
  }
}

export function resolveMarketsPoolConfig(environment: Environment = process.env): PoolConfig | null {
  const discrete = {
    database: environmentValue(environment, 'WORLDSTATE_PGDATABASE'),
    host: environmentValue(environment, 'WORLDSTATE_PGHOST'),
    password: environmentSecret(environment, 'WORLDSTATE_PGPASSWORD'),
    port: environmentValue(environment, 'WORLDSTATE_PGPORT'),
    user: environmentValue(environment, 'WORLDSTATE_PGUSER'),
  };
  const values = Object.values(discrete);
  const hasCompleteDiscreteConfig = values.every((value) => value !== undefined);
  const hasPartialDiscreteConfig = values.some((value) => value !== undefined);
  const common: PoolConfig = {
    application_name: 'osiris-markets-api',
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

type MarketsGlobal = typeof globalThis & {
  __osirisMarketsPool?: Pool;
  __osirisMarketsDatabase?: PostgresMarketsDatabase;
};

export function getMarketsDatabase(environment: Environment = process.env): MarketsDatabase | null {
  const config = resolveMarketsPoolConfig(environment);
  if (config === null) return null;

  const shared = globalThis as MarketsGlobal;
  if (shared.__osirisMarketsDatabase !== undefined) return shared.__osirisMarketsDatabase;

  const pool = new Pool(config);
  pool.on('error', (error) => {
    console.error('[markets] Idle database client error:', error.message);
  });
  const database = new PostgresMarketsDatabase(pool);
  shared.__osirisMarketsPool = pool;
  shared.__osirisMarketsDatabase = database;
  return database;
}
