import { describe, expect, it } from 'vitest';
import type { QueryResultRow } from 'pg';

import {
  PostgresFlightDatabase,
  resolveFlightPoolConfig,
  type FlightQueryExecutor,
} from './database-source';

describe('PostgresFlightDatabase', () => {
  it('maps persisted ADS-B rows into the flights compatibility shape', async () => {
    const executor: FlightQueryExecutor = {
      async query<Row extends QueryResultRow>() {
        return {
          rows: [{
            response_received_at: new Date('2026-01-01T00:00:00.000Z'),
            upstream_timestamp: new Date('2026-01-01T00:00:00.000Z'),
            source_id: 'adsb-lol-military',
            source_aircraft_id: 'ae9999',
            icao24: 'ae9999',
            callsign: 'DUKE99',
            registration: '12-3456',
            aircraft_type: 'C130',
            altitude_meters: 8534,
            speed_knots: 410,
            heading: 270,
            squawk: '7777',
            nac_p: 7,
            military_flag: true,
            latitude: 36.1,
            longitude: -115.2,
          } as unknown as Row],
        };
      },
    };

    const snapshot = await new PostgresFlightDatabase(executor).loadSnapshot(900_000);

    expect(snapshot.responseReceivedAt?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(snapshot.flights[0]).toMatchObject({
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
      aircraft_category: 'plane',
      category: 'military',
    });
  });

  it('reports no successful snapshot when the query returns only the aggregate row', async () => {
    const executor: FlightQueryExecutor = {
      async query<Row extends QueryResultRow>() {
        return {
          rows: [{
            response_received_at: null,
            upstream_timestamp: null,
            source_aircraft_id: null,
          } as unknown as Row],
        };
      },
    };

    const snapshot = await new PostgresFlightDatabase(executor).loadSnapshot(900_000);

    expect(snapshot.responseReceivedAt).toBeNull();
    expect(snapshot.flights).toEqual([]);
  });
});

describe('resolveFlightPoolConfig', () => {
  it('uses discrete world-state settings before DATABASE_URL', () => {
    const config = resolveFlightPoolConfig({
      DATABASE_URL: 'postgresql://ignored:ignored@127.0.0.1:5432/ignored',
      WORLDSTATE_PGDATABASE: 'osiris_worldstate',
      WORLDSTATE_PGHOST: 'db',
      WORLDSTATE_PGPASSWORD: 'secret',
      WORLDSTATE_PGPORT: '5432',
      WORLDSTATE_PGUSER: 'osiris',
    });

    expect(config).toMatchObject({
      application_name: 'osiris-flights-api',
      database: 'osiris_worldstate',
      host: 'db',
      password: 'secret',
      port: 5432,
      user: 'osiris',
    });
  });
});
