import { readFile } from 'node:fs/promises';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  GATECH_IODA_OUTAGES_SOURCE_ID,
  InternetOutageNormalisationError,
  normaliseInternetOutageFeed,
} from '../src/normalisers/internet-outages.js';

let fixtureBody: Buffer;
const observedAt = new Date('2026-01-01T00:00:01.000Z');

beforeAll(async () => {
  fixtureBody = await readFile(new URL('./fixtures/gatech-ioda-outages.json', import.meta.url));
});

describe('normaliseInternetOutageFeed', () => {
  it('normalises country-level IODA outage events with derived centroid geometry', () => {
    const result = normaliseInternetOutageFeed(fixtureBody, observedAt);

    expect(result.sourceId).toBe(GATECH_IODA_OUTAGES_SOURCE_ID);
    expect(result.upstreamTimestamp?.toISOString()).toBe('2026-01-01T00:00:01.000Z');
    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toMatchObject({
      countryCode: 'UA',
      longitude: 32,
      latitude: 49,
      score: 0.82,
      severity: 'high',
      datasource: 'bgp',
      startedAt: new Date('2026-01-01T00:00:00.000Z'),
      endedAt: new Date('2026-01-01T01:00:00.000Z'),
      evidenceClassification: 'observed',
      metadata: {
        provider: 'Georgia Tech IODA',
        format: 'json',
        stableIdentifierSource: 'location_start_datasource_hash',
        locationPrecision: 'country_centroid',
        originalLocation: 'country/UA',
      },
    });
    expect(result.records[0]?.sourceEventId).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.records[0]?.metadata.outage_content_hash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('rejects invalid IODA response bodies', () => {
    expect(() => normaliseInternetOutageFeed(Buffer.from('{'), observedAt)).toThrow(
      InternetOutageNormalisationError,
    );
    expect(() =>
      normaliseInternetOutageFeed(
        Buffer.from('{"data":[{"location":"country/US","start":"bad"}]}'),
        observedAt,
      ),
    ).toThrow(InternetOutageNormalisationError);
  });
});
