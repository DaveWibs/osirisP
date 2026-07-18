import { Pool, type PoolConfig, type QueryResultRow } from 'pg';

type Environment = Readonly<Record<string, string | undefined>>;

export interface PersistedQueryExecutor {
  query<Row extends QueryResultRow>(
    queryText: string,
    values: unknown[],
  ): Promise<{ rows: Row[] }>;
}

export class PersistedDatabaseDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PersistedDatabaseDataError';
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

export function resolvePersistedPoolConfig(
  applicationName: string,
  environment: Environment = process.env,
): PoolConfig | null {
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
    application_name: applicationName,
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

type PersistedGlobal = typeof globalThis & {
  __osirisPersistedPools?: Map<string, Pool>;
};

/**
 * Shared per-feed executor over the World-State database. Pools are cached on
 * globalThis by feed key so hot-reload and per-request module evaluation reuse
 * connections, matching the existing per-feed database-source behavior.
 */
export function getPersistedExecutor(
  feedKey: string,
  applicationName: string,
  environment: Environment = process.env,
): PersistedQueryExecutor | null {
  const config = resolvePersistedPoolConfig(applicationName, environment);
  if (config === null) return null;

  const shared = globalThis as PersistedGlobal;
  shared.__osirisPersistedPools ??= new Map();
  const existing = shared.__osirisPersistedPools.get(feedKey);
  if (existing !== undefined) return existing;

  const pool = new Pool(config);
  pool.on('error', (error) => {
    console.error(`[${feedKey}] Idle database client error:`, error.message);
  });
  shared.__osirisPersistedPools.set(feedKey, pool);
  return pool;
}

export function parsePersistedTimestamp(
  value: Date | string | null | undefined,
  field: string,
): Date | null {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new PersistedDatabaseDataError(`Database returned an invalid ${field} timestamp`);
  }
  return parsed;
}

export function requirePersistedNumber(value: number | null | undefined, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new PersistedDatabaseDataError(`Database returned an invalid ${field} value`);
  }
  return value;
}
