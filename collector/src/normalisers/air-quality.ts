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

// OpenAQ v3 `/v3/parameters/2/latest` rows. Unlike the retired v2 latest
// endpoint, v3 identifies stations only by locationsId/sensorsId and carries
// no location name, country or unit; pm2.5 values are reported in µg/m³.
const openAqLatestRowSchema = z
  .object({
    datetime: z.object({
      utc: z.string().min(1),
      local: z.string().optional(),
    }),
    value: finiteNumberSchema,
    coordinates: z.object({
      latitude: finiteNumberSchema,
      longitude: finiteNumberSchema,
    }),
    sensorsId: z.number(),
    locationsId: z.number(),
  })
  .passthrough();

const openAqResponseSchema = z
  .object({
    results: z.array(openAqLatestRowSchema).default([]),
    meta: z.unknown().optional(),
  })
  .passthrough();

type OpenAqLatestRow = z.infer<typeof openAqLatestRowSchema>;

const PM25_UNIT = 'µg/m³';
// v3 has no country field; the schema requires one, so use the ISO 3166-1
// user-assigned placeholder until rows are enriched from the locations API.
const UNKNOWN_COUNTRY_CODE = 'ZZ';

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

function normalisePm25Row(row: OpenAqLatestRow): NormalisedAirQualityRecord {
  const observedAt = parseDate(row.datetime.utc, 'datetime.utc');
  const contentHash = hashJson(row);

  return {
    sourceId: OPENAQ_LATEST_PM25_SOURCE_ID,
    // Same id scheme as the v2 normaliser's location_id path, so stations
    // keep their identity across the v2 -> v3 migration.
    sourceStationId: `${row.locationsId}:pm25`,
    observedAt,
    sourceUpdatedAt: observedAt,
    locationName: `OpenAQ location ${row.locationsId}`,
    city: null,
    countryCode: UNKNOWN_COUNTRY_CODE,
    longitude: row.coordinates.longitude,
    latitude: row.coordinates.latitude,
    parameter: 'pm25',
    measurementValue: row.value,
    unit: PM25_UNIT,
    level: classifyPm25(row.value),
    contentHash,
    evidenceClassification: 'observed',
    rawPayload: row,
    metadata: {
      provider: 'OpenAQ',
      format: 'json',
      measurement_content_hash: contentHash,
      stableIdentifierSource: 'location_id',
      sourceName: null,
      sensors_id: row.sensorsId,
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

  const records = new Map<string, NormalisedAirQualityRecord>();
  for (const row of parsed.data.results) {
    // Sensors report negative sentinel values (-1, -999) for missing data.
    if (row.value < 0) continue;
    const record = normalisePm25Row(row);
    // A location can host several pm2.5 sensors; keep the freshest reading
    // per station to satisfy the (source_id, source_station_id) uniqueness.
    const existing = records.get(record.sourceStationId);
    if (existing === undefined || record.observedAt > existing.observedAt) {
      records.set(record.sourceStationId, record);
    }
  }

  const uniqueRecords = [...records.values()];
  return {
    sourceId: OPENAQ_LATEST_PM25_SOURCE_ID,
    upstreamTimestamp: latestTimestamp(uniqueRecords),
    records: uniqueRecords,
  };
}
