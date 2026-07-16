import { describe, expect, it } from 'vitest';

import type { MarketsResponse } from './contract';
import {
  loadMarketsRuntimeConfig,
  loadMarketsSnapshot,
  MarketsDatabaseUnavailableError,
  type MarketsRuntimeConfig,
} from './service';

const liveResponse: MarketsResponse = {
  stocks: {},
  oil: {},
  commodities: {},
  crypto: {},
  indices: {},
  scm_alerts: [],
  timestamp: '2026-01-01T00:00:00.000Z',
};

function config(mode: MarketsRuntimeConfig['mode']): MarketsRuntimeConfig {
  return {
    mode,
    databaseMaxAgeMs: 900_000,
    databaseWindowMs: 900_000,
  };
}

describe('loadMarketsRuntimeConfig', () => {
  it('defaults to live mode and validates database modes', () => {
    expect(loadMarketsRuntimeConfig({}).mode).toBe('live');
    expect(loadMarketsRuntimeConfig({
      MARKETS_DATA_MODE: 'database_with_live_fallback',
      MARKETS_DATABASE_MAX_AGE_MS: '60000',
      MARKETS_DATABASE_WINDOW_MS: '120000',
    })).toMatchObject({
      mode: 'database_with_live_fallback',
      databaseMaxAgeMs: 60_000,
      databaseWindowMs: 120_000,
    });
    expect(() => loadMarketsRuntimeConfig({ MARKETS_DATA_MODE: 'bad' }))
      .toThrow('MARKETS_DATA_MODE');
  });
});

describe('loadMarketsSnapshot', () => {
  it('uses live data directly in live mode', async () => {
    const snapshot = await loadMarketsSnapshot(config('live'), {
      loadLive: async () => liveResponse,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(snapshot.source).toBe('live');
    expect(snapshot.response).toBe(liveResponse);
  });

  it('builds a database response from a fresh market snapshot', async () => {
    const snapshot = await loadMarketsSnapshot(config('database'), {
      getDatabase: () => ({
        loadSnapshot: async () => ({
          observations: [
            { symbol: 'RTX', displayName: 'RTX Corporation', price: 101.25, changePercent: 1.2, up: true },
            { symbol: 'CL=F', displayName: 'Crude Oil', price: 77.5, changePercent: -0.5, up: false },
            { symbol: 'BTC-USD', displayName: 'Bitcoin USD', price: 65000, changePercent: 2.1, up: true },
          ],
          responseReceivedAt: new Date('2026-01-01T00:00:00.000Z'),
          upstreamTimestamp: new Date('2026-01-01T00:00:00.000Z'),
        }),
      }),
      loadLive: async () => liveResponse,
      now: () => new Date('2026-01-01T00:01:00.000Z'),
    });

    expect(snapshot.source).toBe('worldstate-database');
    expect(snapshot.response.stocks.RTX).toMatchObject({ price: 101.25, up: true });
    expect(snapshot.response.oil['WTI Crude']).toMatchObject({ price: 77.5, up: false });
    expect(snapshot.response.crypto.Bitcoin).toMatchObject({ price: 65000 });
  });

  it('falls back to live data when database fallback mode is configured', async () => {
    const snapshot = await loadMarketsSnapshot(config('database_with_live_fallback'), {
      getDatabase: () => null,
      loadLive: async () => liveResponse,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(snapshot.source).toBe('live-fallback');
    expect(snapshot.fallbackReason).toBe('database-unconfigured');
  });

  it('fails closed in database-only mode', async () => {
    await expect(loadMarketsSnapshot(config('database'), {
      getDatabase: () => null,
      loadLive: async () => liveResponse,
    })).rejects.toBeInstanceOf(MarketsDatabaseUnavailableError);
  });
});
