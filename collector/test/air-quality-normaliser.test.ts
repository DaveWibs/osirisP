import { readFile } from 'node:fs/promises';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  AirQualityNormalisationError,
  OPENAQ_LATEST_PM25_SOURCE_ID,
  normaliseAirQualityFeed,
} from '../src/normalisers/air-quality.js';

let fixtureBody: Buffer;

beforeAll(async () => {
  fixtureBody = await readFile(new URL('./fixtures/openaq-latest-pm25.json', import.meta.url));
});

describe('normaliseAirQualityFeed', () => {
  it('normalises OpenAQ latest PM2.5 measurements', () => {
    const result = normaliseAirQualityFeed(fixtureBody);

    expect(result.sourceId).toBe(OPENAQ_LATEST_PM25_SOURCE_ID);
    expect(result.records).toHaveLength(1);
    expect(result.upstreamTimestamp?.toISOString()).toBe('2026-01-01T00:15:00.000Z');
    expect(result.records[0]).toMatchObject({
      sourceStationId: '12345:pm25',
      locationName: 'Fixture Central',
      city: 'Fixture City',
      countryCode: 'AU',
      latitude: -33.8688,
      longitude: 151.2093,
      parameter: 'pm25',
      measurementValue: 42.5,
      unit: 'µg/m³',
      level: 'Moderate',
      evidenceClassification: 'observed',
      metadata: {
        provider: 'OpenAQ',
        format: 'json',
        stableIdentifierSource: 'location_id',
        sourceName: 'Fixture Sensor Network',
      },
    });
    expect(result.records[0]?.metadata.measurement_content_hash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('rejects invalid OpenAQ response bodies', () => {
    expect(() => normaliseAirQualityFeed(Buffer.from('{'))).toThrow(AirQualityNormalisationError);
    expect(() => normaliseAirQualityFeed(Buffer.from('{"results":[{"location":""}]}'))).toThrow(
      AirQualityNormalisationError,
    );
  });
});
