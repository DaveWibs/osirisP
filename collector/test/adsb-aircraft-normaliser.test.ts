import { readFile } from 'node:fs/promises';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  AIRPLANES_LIVE_MILITARY_SOURCE_ID,
  AdsbAircraftNormalisationError,
  normaliseAdsbAircraftFeed,
} from '../src/normalisers/adsb-aircraft.js';

let fixtureBody: Buffer;
const observedAt = new Date('2026-01-01T00:00:01.000Z');

beforeAll(async () => {
  fixtureBody = await readFile(new URL('./fixtures/airplanes-live-military.json', import.meta.url));
});

describe('normaliseAdsbAircraftFeed', () => {
  it('normalises airplanes.live military ADS-B aircraft rows', () => {
    const result = normaliseAdsbAircraftFeed(
      fixtureBody,
      AIRPLANES_LIVE_MILITARY_SOURCE_ID,
      observedAt,
    );

    expect(result.sourceId).toBe(AIRPLANES_LIVE_MILITARY_SOURCE_ID);
    expect(result.upstreamTimestamp?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toMatchObject({
      sourceAircraftId: 'ae1234',
      icao24: 'ae1234',
      callsign: 'RCH123',
      registration: '08-0001',
      aircraftType: 'C17',
      latitude: 34.12346,
      longitude: -117.12346,
      altitudeMeters: 9754,
      speedKnots: 420.5,
      heading: 87.2,
      squawk: '1234',
      nacP: 8,
      militaryFlag: true,
      evidenceClassification: 'observed',
      metadata: {
        provider: 'airplanes.live',
        format: 'json',
        stableIdentifierSource: 'icao24',
      },
    });
    expect(result.records[0]?.metadata.aircraft_content_hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.records[1]).toMatchObject({ sourceAircraftId: 'ae5678', altitudeMeters: null });
  });

  it('rejects invalid ADS-B response bodies', () => {
    expect(() =>
      normaliseAdsbAircraftFeed(Buffer.from('{'), AIRPLANES_LIVE_MILITARY_SOURCE_ID, observedAt),
    ).toThrow(AdsbAircraftNormalisationError);
    expect(() =>
      normaliseAdsbAircraftFeed(
        Buffer.from('{"ac":[{"hex":123}]}'),
        AIRPLANES_LIVE_MILITARY_SOURCE_ID,
        observedAt,
      ),
    ).toThrow(AdsbAircraftNormalisationError);
  });
});
