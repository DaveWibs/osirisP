import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { z } from 'zod';

export const OPENAQ_LATEST_PM25_SOURCE_ID = 'openaq-latest-pm25' as const;

export type AirQualitySourceId = typeof OPENAQ_LATEST_PM25_SOURCE_ID;

export type AirQualityLevel =
  | 'Good'
  | 'Moderate'
  | 'Unhealthy (Sensitive)'
  | 'Unhealthy'
  | 'Hazardous';

const finiteNumberSchema = z.number().refine(Number.isFinite, 'must be finite');

const openAqMeasurementSchema = z
  .object({
    parameter: z.string().min(1),
    value: finiteNumberSchema,
    unit: z.string().min(1),
    lastUpdated: z.string().min(1),
    sourceName: z.string().optional(),
  })
  .passthrough();

const openAqLocationSchema = z
  .object({
    location: z.string().min(1),
    locationId: z.union([z.string(), z.number()]).optional(),
    city: z.string().optional().nullable(),
    country: z.string().min(1),
    coordinates: z.object({
      latitude: finiteNumberSchema,
      longitude: finiteNumberSchema,
    }),
    measurements: z.array(openAqMeasurementSchema).default([]),
  })
  .passthrough();

const openAqResponseSchema = z
  .object({
    results: z.array(openAqLocationSchema).default([]),
    meta: z.unknown().optional(),
  })
  .passthrough();

type OpenAqLocation = z.infer<typeof openAqLocationSchema>;
type OpenAqMeasurement = z.infer<typeof openAqMeasurementSchema>;

export interface NormalisedAirQualityRecord {
  sourceId: AirQualitySourceId;
  sourceStationId: string;
  observedAt: Date;
  sourceUpdatedAt: Date;
  locationName: string;
  city: string | null;
  countryCode: string;
  longitude: number;
  latitude: number;
  parameter: 'pm25';
  measurementValue: number;
  unit: string;
  level: AirQualityLevel;
  contentHash: string;
  evidenceClassification: 'observed';
  rawPayload: unknown;
  metadata: {
    provider: 'OpenAQ';
    format: 'json';
    measurement_content_hash: string;
    stableIdentifierSource: string;
    sourceName: string | null;
    [key: string]: unknown;
  };
}

export interface NormalisedAirQualityFeed {
  sourceId: AirQualitySourceId;
  upstreamTimestamp: Date | null;
  records: NormalisedAirQualityRecord[];
}

export class AirQualityNormalisationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AirQualityNormalisationError';
  }
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function parseDate(value: string, label: string): Date {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new AirQualityNormalisationError(`OpenAQ row has invalid ${label}`);
  }
  return parsed;
}

function classifyPm25(value: number): AirQualityLevel {
  if (value > 150) return 'Hazardous';
  if (value > 100) return 'Unhealthy';
  if (value > 55) return 'Unhealthy (Sensitive)';
  if (value > 35) return 'Moderate';
  return 'Good';
}

function stableStationId(location: OpenAqLocation): { id: string; source: string } {
  if (location.locationId !== undefined) {
    return { id: `${location.locationId}:pm25`, source: 'location_id' };
  }

  return {
    id: [
      location.country,
      location.location,
      location.coordinates.latitude.toFixed(5),
      location.coordinates.longitude.toFixed(5),
      'pm25',
    ].join(':'),
    source: 'country_location_coordinates_parameter',
  };
}

function normalisePm25Measurement(
  location: OpenAqLocation,
  measurement: OpenAqMeasurement,
): NormalisedAirQualityRecord {
  const observedAt = parseDate(measurement.lastUpdated, 'lastUpdated');
  const station = stableStationId(location);
  const contentHash = hashJson({ location, measurement });

  return {
    sourceId: OPENAQ_LATEST_PM25_SOURCE_ID,
    sourceStationId: station.id,
    observedAt,
    sourceUpdatedAt: observedAt,
    locationName: location.location,
    city: location.city ?? null,
    countryCode: location.country,
    longitude: location.coordinates.longitude,
    latitude: location.coordinates.latitude,
    parameter: 'pm25',
    measurementValue: measurement.value,
    unit: measurement.unit,
    level: classifyPm25(measurement.value),
    contentHash,
    evidenceClassification: 'observed',
    rawPayload: location,
    metadata: {
      provider: 'OpenAQ',
      format: 'json',
      measurement_content_hash: contentHash,
      stableIdentifierSource: station.source,
      sourceName: measurement.sourceName ?? null,
    },
  };
}

function latestTimestamp(records: NormalisedAirQualityRecord[]): Date | null {
  return records.reduce<Date | null>((current, record) => {
    if (current === null || record.sourceUpdatedAt.getTime() > current.getTime()) {
      return record.sourceUpdatedAt;
    }
    return current;
  }, null);
}

export function normaliseAirQualityFeed(body: Buffer): NormalisedAirQualityFeed {
  if (!Buffer.isBuffer(body)) {
    throw new AirQualityNormalisationError('OpenAQ response body must be a Buffer');
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(body.toString('utf8')) as unknown;
  } catch {
    throw new AirQualityNormalisationError('Invalid OpenAQ JSON response body');
  }

  const parsed = openAqResponseSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new AirQualityNormalisationError('Invalid OpenAQ latest response body');
  }

  const records = parsed.data.results.flatMap((location) => {
    const pm25 = location.measurements.find((measurement) => measurement.parameter === 'pm25');
    return pm25 === undefined ? [] : [normalisePm25Measurement(location, pm25)];
  });

  return {
    sourceId: OPENAQ_LATEST_PM25_SOURCE_ID,
    upstreamTimestamp: latestTimestamp(records),
    records,
  };
}
