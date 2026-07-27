import { Buffer } from 'node:buffer';

import { describe, expect, it, vi } from 'vitest';

import { OpenAqLocationResolver } from '../src/collectors/openaq-location-resolver.js';
import { createLogger } from '../src/logger.js';
import type { NormalisedAirQualityRecord } from '../src/normalisers/air-quality.js';

const logger = createLogger('silent');

function record(locationId: number | undefined): NormalisedAirQualityRecord {
  return {
    sourceId: 'openaq-latest-pm25',
    sourceStationId: `${locationId}:pm25`,
    observedAt: new Date('2026-01-01T00:00:00.000Z'),
    sourceUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
    locationName: `OpenAQ location ${locationId}`,
    city: null,
    countryCode: 'ZZ',
    longitude: 0,
    latitude: 0,
    parameter: 'pm25',
    measurementValue: 10,
    unit: 'µg/m³',
    level: 'Good',
    contentHash: 'a'.repeat(64),
    evidenceClassification: 'observed',
    rawPayload: {},
    metadata: {
      provider: 'OpenAQ',
      format: 'json',
      measurement_content_hash: 'a'.repeat(64),
      stableIdentifierSource: 'location_id',
      sourceName: null,
      ...(locationId === undefined ? {} : { location_id: locationId }),
    },
  };
}

function locationResponse(id: number, code: string | null, name: string, locality: string | null) {
  return {
    status: 200,
    endpoint: `https://api.openaq.org/v3/locations/${id}`,
    requestStartedAt: new Date(),
    responseReceivedAt: new Date(),
    contentType: 'application/json',
    headers: {},
    body: Buffer.from(
      JSON.stringify({ results: [{ id, name, locality, country: { code } }] }),
      'utf8',
    ),
  };
}

describe('OpenAqLocationResolver', () => {
  it('fills country, name and locality and sends the API key', async () => {
    const fetch = vi.fn(async () => locationResponse(12345, 'kr', '회원동', 'Changwon'));
    const resolver = new OpenAqLocationResolver({ fetcher: { fetch }, logger, apiKey: 'k' });

    const [enriched] = await resolver.enrich([record(12345)]);

    expect(enriched).toMatchObject({
      countryCode: 'KR',
      locationName: '회원동',
      city: 'Changwon',
    });
    expect(enriched?.metadata.sourceName).toBe('회원동');
    expect(fetch).toHaveBeenCalledWith(
      'https://api.openaq.org/v3/locations/12345',
      undefined,
      { 'x-api-key': 'k' },
    );
  });

  it('caches a resolved location and never re-fetches it', async () => {
    const fetch = vi.fn(async () => locationResponse(7, 'GH', 'NMA - Nima', null));
    const resolver = new OpenAqLocationResolver({ fetcher: { fetch }, logger });

    await resolver.enrich([record(7)]);
    await resolver.enrich([record(7), record(7)]);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('caps lookups per cycle and resolves the rest on a later cycle', async () => {
    const fetch = vi.fn(async (endpoint: string | URL) => {
      const id = Number(String(endpoint).split('/').pop());
      return locationResponse(id, 'US', `loc ${id}`, null);
    });
    const resolver = new OpenAqLocationResolver({
      fetcher: { fetch },
      logger,
      maxLookupsPerCycle: 2,
    });
    const records = [record(1), record(2), record(3)];

    await resolver.enrich(records);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(records.filter((r) => r.countryCode === 'US')).toHaveLength(2);
    expect(records.find((r) => r.sourceStationId === '3:pm25')?.countryCode).toBe('ZZ');

    await resolver.enrich(records);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(records.every((r) => r.countryCode === 'US')).toBe(true);
  });

  it('keeps the placeholder when a lookup fails and does not throw', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('network down');
    });
    const resolver = new OpenAqLocationResolver({ fetcher: { fetch }, logger });

    const [enriched] = await resolver.enrich([record(99)]);

    expect(enriched?.countryCode).toBe('ZZ');
    expect(enriched?.locationName).toBe('OpenAQ location 99');
  });

  it('falls back to ZZ for a non-ISO country code and skips records with no location id', async () => {
    const fetch = vi.fn(async () => locationResponse(5, null, 'Mystery', null));
    const resolver = new OpenAqLocationResolver({ fetcher: { fetch }, logger });

    const withCode = record(5);
    const withoutId = record(undefined);
    await resolver.enrich([withCode, withoutId]);

    expect(withCode.countryCode).toBe('ZZ');
    expect(withCode.locationName).toBe('Mystery');
    expect(withoutId.countryCode).toBe('ZZ');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
