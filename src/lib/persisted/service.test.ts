import { describe, expect, it } from 'vitest';

import {
  PersistedDatabaseUnavailableError,
  loadPersistedRuntimeConfig,
  loadPersistedSnapshot,
  persistedResponseHeaders,
  type PersistedDatabaseResult,
  type PersistedRuntimeConfig,
} from './service';

const NOW = new Date('2026-07-18T12:00:00Z');

function config(mode: PersistedRuntimeConfig['mode']): PersistedRuntimeConfig {
  return { mode, databaseMaxAgeMs: 900_000, databaseWindowMs: 900_000 };
}

function databaseResult(ageMs: number, rows = ['db-row']): PersistedDatabaseResult<string[]> {
  return {
    rows,
    responseReceivedAt: new Date(NOW.getTime() - ageMs),
    upstreamTimestamp: new Date(NOW.getTime() - ageMs),
  };
}

function dependencies(overrides: Partial<Parameters<typeof loadPersistedSnapshot<string, string[]>>[1]> = {}) {
  return {
    label: 'test-feed',
    getDatabaseResult: () => databaseResult(60_000),
    buildDatabaseResponse: (rows: string[]) => `db:${rows.join(',')}`,
    loadLive: async () => 'live-response',
    now: () => NOW,
    ...overrides,
  };
}

describe('loadPersistedRuntimeConfig', () => {
  it('defaults to live mode with standard windows', () => {
    expect(loadPersistedRuntimeConfig('NEWS', {})).toEqual({
      mode: 'live',
      databaseMaxAgeMs: 900_000,
      databaseWindowMs: 900_000,
    });
  });

  it('reads prefixed mode and duration variables', () => {
    expect(loadPersistedRuntimeConfig('RADAR', {
      RADAR_DATA_MODE: 'database_with_live_fallback',
      RADAR_DATABASE_MAX_AGE_MS: '600000',
      RADAR_DATABASE_WINDOW_MS: '1200000',
    })).toEqual({
      mode: 'database_with_live_fallback',
      databaseMaxAgeMs: 600_000,
      databaseWindowMs: 1_200_000,
    });
  });

  it('rejects unknown modes and out-of-range durations', () => {
    expect(() => loadPersistedRuntimeConfig('NEWS', { NEWS_DATA_MODE: 'cached' })).toThrow('NEWS_DATA_MODE');
    expect(() => loadPersistedRuntimeConfig('NEWS', {
      NEWS_DATA_MODE: 'database',
      NEWS_DATABASE_MAX_AGE_MS: '10',
    })).toThrow('NEWS_DATABASE_MAX_AGE_MS');
  });
});

describe('loadPersistedSnapshot', () => {
  it('serves live mode without touching the database', async () => {
    let databaseCalls = 0;
    const snapshot = await loadPersistedSnapshot(config('live'), dependencies({
      getDatabaseResult: () => {
        databaseCalls += 1;
        return databaseResult(0);
      },
    }));
    expect(snapshot).toMatchObject({ response: 'live-response', source: 'live', fallbackReason: null });
    expect(databaseCalls).toBe(0);
  });

  it('serves a fresh database snapshot in database mode', async () => {
    const snapshot = await loadPersistedSnapshot(config('database'), dependencies());
    expect(snapshot).toMatchObject({
      response: 'db:db-row',
      source: 'worldstate-database',
      databaseStale: false,
      fallbackReason: null,
    });
    expect(snapshot.databaseResponseReceivedAt?.toISOString()).toBe('2026-07-18T11:59:00.000Z');
  });

  it('passes the configured window to the database loader', async () => {
    let seenWindow = 0;
    await loadPersistedSnapshot(
      { mode: 'database', databaseMaxAgeMs: 900_000, databaseWindowMs: 123_000 },
      dependencies({
        getDatabaseResult: (windowMs) => {
          seenWindow = windowMs;
          return databaseResult(0);
        },
      }),
    );
    expect(seenWindow).toBe(123_000);
  });

  it('measures age without an upstream timestamp when the provider supplied none', async () => {
    const snapshot = await loadPersistedSnapshot(config('database'), dependencies({
      getDatabaseResult: () => ({
        rows: ['db-row'],
        responseReceivedAt: new Date(NOW.getTime() - 60_000),
        upstreamTimestamp: null,
      }),
    }));
    expect(snapshot.source).toBe('worldstate-database');
    expect(snapshot.databaseUpstreamTimestamp).toBeNull();
  });

  it('fails closed in database mode', async () => {
    await expect(loadPersistedSnapshot(config('database'), dependencies({
      getDatabaseResult: () => null,
    }))).rejects.toThrow(PersistedDatabaseUnavailableError);

    await expect(loadPersistedSnapshot(config('database'), dependencies({
      getDatabaseResult: () => {
        throw new Error('connect ECONNREFUSED');
      },
    }))).rejects.toThrow('test-feed database is unavailable');

    await expect(loadPersistedSnapshot(config('database'), dependencies({
      getDatabaseResult: () => ({ rows: [], responseReceivedAt: null, upstreamTimestamp: null }),
    }))).rejects.toThrow('test-feed database has no successful collection');

    await expect(loadPersistedSnapshot(config('database'), dependencies({
      getDatabaseResult: () => databaseResult(3_600_000),
    }))).rejects.toThrow('test-feed database snapshot is stale');
  });

  it('falls back live with a sanitised reason in database_with_live_fallback mode', async () => {
    const warnings: string[] = [];
    const warn = (message: string) => warnings.push(message);

    const unconfigured = await loadPersistedSnapshot(config('database_with_live_fallback'), dependencies({
      getDatabaseResult: () => null,
      warn,
    }));
    expect(unconfigured).toMatchObject({ response: 'live-response', source: 'live-fallback', fallbackReason: 'database-unconfigured' });

    const unavailable = await loadPersistedSnapshot(config('database_with_live_fallback'), dependencies({
      getDatabaseResult: () => {
        throw new Error('boom');
      },
      warn,
    }));
    expect(unavailable.fallbackReason).toBe('database-unavailable');

    const withoutSuccess = await loadPersistedSnapshot(config('database_with_live_fallback'), dependencies({
      getDatabaseResult: () => ({ rows: [], responseReceivedAt: null, upstreamTimestamp: null }),
      warn,
    }));
    expect(withoutSuccess.fallbackReason).toBe('database-without-success');

    const stale = await loadPersistedSnapshot(config('database_with_live_fallback'), dependencies({
      getDatabaseResult: () => databaseResult(3_600_000),
      warn,
    }));
    expect(stale).toMatchObject({ fallbackReason: 'database-stale', databaseStale: true });
    expect(stale.databaseResponseReceivedAt).not.toBeNull();

    expect(warnings).toHaveLength(4);
    expect(warnings.every((message) => message.startsWith('[test-feed]'))).toBe(true);
    expect(warnings.join('\n')).not.toContain('boom');
  });

  it('serves a fresh database snapshot in fallback mode without calling live', async () => {
    let liveCalls = 0;
    const snapshot = await loadPersistedSnapshot(config('database_with_live_fallback'), dependencies({
      loadLive: async () => {
        liveCalls += 1;
        return 'live-response';
      },
    }));
    expect(snapshot.source).toBe('worldstate-database');
    expect(liveCalls).toBe(0);
  });
});

describe('persistedResponseHeaders', () => {
  it('reports mode, source, timestamps, staleness and fallback reason', async () => {
    const snapshot = await loadPersistedSnapshot(config('database_with_live_fallback'), dependencies({
      getDatabaseResult: () => databaseResult(3_600_000),
      warn: () => undefined,
    }));
    const headers = persistedResponseHeaders('News', snapshot, 'public, s-maxage=60');
    expect(headers).toMatchObject({
      'Cache-Control': 'public, s-maxage=60',
      'X-OSIRIS-News-Mode': 'database_with_live_fallback',
      'X-OSIRIS-News-Source': 'live-fallback',
      'X-OSIRIS-News-Fallback': 'database-stale',
      'X-OSIRIS-Database-Stale': 'true',
    });
    expect(headers['X-OSIRIS-Database-Response-Received']).toBe('2026-07-18T11:00:00.000Z');
  });

  it('omits database headers when no snapshot metadata exists', async () => {
    const snapshot = await loadPersistedSnapshot(config('live'), dependencies());
    const headers = persistedResponseHeaders('Crypto', snapshot, 'no-store');
    expect(Object.keys(headers).sort()).toEqual([
      'Cache-Control',
      'X-OSIRIS-Crypto-Mode',
      'X-OSIRIS-Crypto-Source',
    ]);
  });
});
