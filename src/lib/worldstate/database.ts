import { Pool, type PoolConfig, type QueryResultRow } from 'pg';
import { logWorldStateError } from './logging';

type Environment = Readonly<Record<string, string | undefined>>;

export interface WorldStateQueryExecutor {
  query<Row extends QueryResultRow>(
    queryText: string,
    values?: unknown[],
  ): Promise<{ rows: Row[] }>;
}

export class WorldStateDatabaseUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorldStateDatabaseUnavailableError';
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

export function resolveWorldStatePoolConfig(
  environment: Environment = process.env,
  applicationName = 'osiris-worldstate-v1-api',
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
    return {
      ...common,
      database: discrete.database,
      host: discrete.host,
      password: discrete.password,
      port,
      user: discrete.user,
    };
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

type WorldStateGlobal = typeof globalThis & {
  __osirisWorldStateV1Pool?: Pool;
};

export function getWorldStateDatabase(environment: Environment = process.env): WorldStateQueryExecutor | null {
  const config = resolveWorldStatePoolConfig(environment);
  if (config === null) return null;

  const shared = globalThis as WorldStateGlobal;
  if (shared.__osirisWorldStateV1Pool !== undefined) {
    return shared.__osirisWorldStateV1Pool;
  }

  const pool = new Pool(config);
  pool.on('error', (error) => {
    logWorldStateError(error, {
      route: 'worldstate:database',
      operation: 'idle_database_client_error',
    });
  });
  shared.__osirisWorldStateV1Pool = pool;
  return pool;
}
