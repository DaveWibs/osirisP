import type { QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';

import {
  PostgresMarketsDatabase,
  resolveMarketsPoolConfig,
  type MarketsQueryExecutor,
} from './database-source';

describe('PostgresMarketsDatabase', () => {
  it('maps persisted market rows into observations', async () => {
    const executor: MarketsQueryExecutor = {
      async query<Row extends QueryResultRow>() {
        return {
          rows: [{
            response_received_at: new Date('2026-01-01T00:00:00.000Z'),
            upstream_timestamp: new Date('2026-01-01T00:00:00.000Z'),
            symbol: 'RTX',
            display_name: 'RTX Corporation',
            price: 101.25,
            change_percent: 1.2,
            up: true,
          } as unknown as Row],
        };
      },
    };

    const snapshot = await new PostgresMarketsDatabase(executor).loadSnapshot(900_000);

    expect(snapshot.responseReceivedAt?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(snapshot.observations[0]).toMatchObject({
      symbol: 'RTX',
      displayName: 'RTX Corporation',
      price: 101.25,
      changePercent: 1.2,
      up: true,
    });
  });

  it('reports no successful snapshot when the query returns only the aggregate row', async () => {
    const executor: MarketsQueryExecutor = {
      async query<Row extends QueryResultRow>() {
        return {
          rows: [{
            response_received_at: null,
            upstream_timestamp: null,
            symbol: null,
          } as unknown as Row],
        };
      },
    };

    const snapshot = await new PostgresMarketsDatabase(executor).loadSnapshot(900_000);

    expect(snapshot.responseReceivedAt).toBeNull();
    expect(snapshot.observations).toEqual([]);
  });
});

describe('resolveMarketsPoolConfig', () => {
  it('uses discrete world-state settings before DATABASE_URL', () => {
    const config = resolveMarketsPoolConfig({
      DATABASE_URL: 'postgresql://ignored:ignored@127.0.0.1:5432/ignored',
      WORLDSTATE_PGDATABASE: 'osiris_worldstate',
      WORLDSTATE_PGHOST: 'db',
      WORLDSTATE_PGPASSWORD: 'secret',
      WORLDSTATE_PGPORT: '5432',
      WORLDSTATE_PGUSER: 'osiris',
    });

    expect(config).toMatchObject({
      application_name: 'osiris-markets-api',
      database: 'osiris_worldstate',
      host: 'db',
      password: 'secret',
      port: 5432,
      user: 'osiris',
    });
  });
});
