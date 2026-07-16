import { describe, expect, it } from 'vitest';

import type { FlightResponse } from './contract';
import {
  FlightDatabaseUnavailableError,
  loadFlightRuntimeConfig,
  loadFlightSnapshot,
  type FlightRuntimeConfig,
} from './service';

const liveResponse: FlightResponse = {
  commercial_flights: [],
  private_flights: [],
  private_jets: [],
  military_flights: [],
  gps_jamming: [],
  total: 0,
  source: 'live-test',
  timestamp: '2026-01-01T00:00:00.000Z',
};

function config(mode: FlightRuntimeConfig['mode']): FlightRuntimeConfig {
  return {
    mode,
    databaseMaxAgeMs: 900_000,
    databaseWindowMs: 900_000,
  };
}

describe('loadFlightRuntimeConfig', () => {
  it('defaults to live mode and validates database modes', () => {
    expect(loadFlightRuntimeConfig({}).mode).toBe('live');
    expect(loadFlightRuntimeConfig({
      FLIGHTS_DATA_MODE: 'database_with_live_fallback',
      FLIGHTS_DATABASE_MAX_AGE_MS: '60000',
      FLIGHTS_DATABASE_WINDOW_MS: '120000',
    })).toMatchObject({
      mode: 'database_with_live_fallback',
      databaseMaxAgeMs: 60_000,
      databaseWindowMs: 120_000,
    });
    expect(() => loadFlightRuntimeConfig({ FLIGHTS_DATA_MODE: 'bad' }))
      .toThrow('FLIGHTS_DATA_MODE');
  });
});

describe('loadFlightSnapshot', () => {
  it('uses live data directly in live mode', async () => {
    const snapshot = await loadFlightSnapshot(config('live'), {
      loadLive: async () => liveResponse,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(snapshot.source).toBe('live');
    expect(snapshot.response).toBe(liveResponse);
  });

  it('builds a database response from a fresh aviation snapshot', async () => {
    const snapshot = await loadFlightSnapshot(config('database'), {
      getDatabase: () => ({
        loadSnapshot: async () => ({
          flights: [{
            callsign: 'DUKE99',
            lat: 36.1,
            lng: -115.2,
            alt: 8534,
            heading: 270,
            speed_knots: 410,
            model: 'C130',
            icao24: 'ae9999',
            registration: '12-3456',
            squawk: '7777',
            airline_code: '',
            aircraft_category: 'plane',
            category: 'military',
            grounded: false,
            nac_p: 7,
            type: 'flight',
          }],
          gpsJamming: [],
          responseReceivedAt: new Date('2026-01-01T00:00:00.000Z'),
          upstreamTimestamp: new Date('2026-01-01T00:00:00.000Z'),
        }),
      }),
      loadLive: async () => liveResponse,
      now: () => new Date('2026-01-01T00:01:00.000Z'),
    });

    expect(snapshot.source).toBe('worldstate-database');
    expect(snapshot.response.military_flights).toHaveLength(1);
    expect(snapshot.response.total).toBe(1);
  });

  it('falls back to live data when database fallback mode is configured', async () => {
    const snapshot = await loadFlightSnapshot(config('database_with_live_fallback'), {
      getDatabase: () => null,
      loadLive: async () => liveResponse,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(snapshot.source).toBe('live-fallback');
    expect(snapshot.fallbackReason).toBe('database-unconfigured');
  });

  it('fails closed in database-only mode', async () => {
    await expect(loadFlightSnapshot(config('database'), {
      getDatabase: () => null,
      loadLive: async () => liveResponse,
    })).rejects.toBeInstanceOf(FlightDatabaseUnavailableError);
  });
});
