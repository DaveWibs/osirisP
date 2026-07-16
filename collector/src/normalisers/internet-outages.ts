import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { z } from 'zod';

export const GATECH_IODA_OUTAGES_SOURCE_ID = 'gatech-ioda-outages' as const;

export type InternetOutageSourceId = typeof GATECH_IODA_OUTAGES_SOURCE_ID;

const COUNTRY_CENTROIDS: Record<string, [number, number]> = {
  AF: [65, 33], AL: [20, 41], DZ: [3, 28], AO: [18.5, -12.5], AR: [-64, -34],
  AM: [45, 40], AU: [134, -25], AT: [14, 47.5], AZ: [50, 40.5], BD: [90, 24],
  BY: [28, 53], BE: [4, 50.8], BR: [-51, -10], BG: [25.5, 42.7],
  KH: [105, 12.5], CM: [12, 6], CA: [-96, 62], CL: [-71, -30], CN: [105, 35],
  CO: [-72, 4], CD: [24, -3], CG: [15.8, -0.2], HR: [16, 45.2],
  CU: [-79.5, 22], CZ: [15.5, 49.8], DK: [10, 56], EC: [-78.5, -2],
  EG: [30, 27], ET: [39.5, 9], FI: [26, 64], FR: [2, 46], DE: [10, 51],
  GH: [-1.5, 8], GR: [22, 39], GT: [-90.4, 15.5], HN: [-86.6, 14.8],
  HU: [19.5, 47], IN: [79, 22], ID: [120, -5], IR: [53, 32], IQ: [44, 33],
  IE: [-8, 53], IL: [34.8, 31.5], IT: [12.5, 42.8], JP: [138, 36],
  JO: [36.5, 31], KZ: [67, 48], KE: [38, 1], KW: [47.5, 29.5],
  LB: [35.8, 33.9], LY: [17, 27], LT: [24, 55.5], MG: [47, -19],
  MY: [112, 3], MX: [-102, 23.5], MA: [-6, 32], MZ: [35, -18.2],
  MM: [96.5, 22], NP: [84, 28.2], NL: [5.5, 52.5], NZ: [174, -41],
  NG: [8, 10], NO: [8, 62], PK: [70, 30], PS: [35.2, 31.9], PA: [-80, 9],
  PE: [-76, -10], PH: [122, 12.5], PL: [19.5, 52], PT: [-8, 39.5],
  RO: [25, 46], RU: [100, 60], SA: [45, 25], SN: [-14.5, 14.5],
  RS: [21, 44], SG: [103.8, 1.35], SK: [19.5, 48.7], ZA: [24, -29],
  KR: [128, 36], ES: [-4, 40], SD: [30, 15], SE: [16, 62], CH: [8, 47],
  SY: [38, 35], TW: [121, 23.7], TZ: [35, -6], TH: [101, 15], TR: [35, 39],
  UA: [32, 49], AE: [54, 24], GB: [-2, 54], US: [-97, 38], UZ: [65, 41.5],
  VE: [-66, 8], VN: [106, 16], YE: [48, 15.5], ZM: [28, -14], ZW: [30, -20],
};

const finiteNumberSchema = z.number().refine(Number.isFinite, 'must be finite');

const unixTimeSchema = z.union([finiteNumberSchema, z.string().min(1)]).optional().nullable();

const iodaEventSchema = z
  .object({
    location: z.string().min(1),
    start: unixTimeSchema,
    duration: z.union([finiteNumberSchema, z.string().min(1)]).optional().nullable(),
    score: finiteNumberSchema.optional().nullable(),
    severity: z.string().optional().nullable(),
    datasource: z.string().optional().nullable(),
  })
  .passthrough();

const iodaResponseSchema = z
  .object({
    data: z.array(iodaEventSchema).default([]),
  })
  .passthrough();

type IodaEvent = z.infer<typeof iodaEventSchema>;

export interface NormalisedInternetOutageRecord {
  sourceId: InternetOutageSourceId;
  sourceEventId: string;
  observedAt: Date;
  sourceUpdatedAt: Date;
  startedAt: Date;
  endedAt: Date | null;
  countryCode: string;
  longitude: number;
  latitude: number;
  score: number;
  severity: string;
  datasource: string;
  contentHash: string;
  evidenceClassification: 'observed';
  rawPayload: unknown;
  metadata: {
    provider: 'Georgia Tech IODA';
    format: 'json';
    outage_content_hash: string;
    stableIdentifierSource: string;
    locationPrecision: 'country_centroid';
    originalLocation: string;
    [key: string]: unknown;
  };
}

export interface NormalisedInternetOutageFeed {
  sourceId: InternetOutageSourceId;
  upstreamTimestamp: Date | null;
  records: NormalisedInternetOutageRecord[];
}

export class InternetOutageNormalisationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InternetOutageNormalisationError';
  }
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function hashText(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function parseUnixSeconds(value: string | number | null | undefined, fallback: Date): Date {
  if (value === undefined || value === null || value === '') return fallback;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    throw new InternetOutageNormalisationError('IODA event has invalid start timestamp');
  }
  const parsed = new Date(numeric * 1000);
  if (!Number.isFinite(parsed.getTime())) {
    throw new InternetOutageNormalisationError('IODA event has invalid start timestamp');
  }
  return parsed;
}

function parseDurationSeconds(value: string | number | null | undefined): number | null {
  if (value === undefined || value === null || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new InternetOutageNormalisationError('IODA event has invalid duration');
  }
  return numeric;
}

function countryCodeFromLocation(location: string): string | null {
  const match = location.match(/^country\/([A-Z]{2})$/u);
  return match?.[1] ?? null;
}

function normaliseEvent(
  event: IodaEvent,
  observedAt: Date,
): NormalisedInternetOutageRecord | null {
  const countryCode = countryCodeFromLocation(event.location);
  if (countryCode === null) return null;
  const centroid = COUNTRY_CENTROIDS[countryCode];
  if (centroid === undefined) return null;

  const startedAt = parseUnixSeconds(event.start, observedAt);
  const durationSeconds = parseDurationSeconds(event.duration);
  const endedAt =
    durationSeconds === null ? null : new Date(startedAt.getTime() + durationSeconds * 1000);
  const datasource = event.datasource?.trim() || 'unknown';
  const severity = event.severity?.trim() || 'unknown';
  const score = event.score ?? 0;
  const contentHash = hashJson(event);
  const stableIdentifier = `${event.location}:${startedAt.toISOString()}:${datasource}`;
  const [longitude, latitude] = centroid;

  return {
    sourceId: GATECH_IODA_OUTAGES_SOURCE_ID,
    sourceEventId: hashText(stableIdentifier),
    observedAt,
    sourceUpdatedAt: observedAt,
    startedAt,
    endedAt,
    countryCode,
    longitude,
    latitude,
    score,
    severity,
    datasource,
    contentHash,
    evidenceClassification: 'observed',
    rawPayload: event,
    metadata: {
      provider: 'Georgia Tech IODA',
      format: 'json',
      outage_content_hash: contentHash,
      stableIdentifierSource: 'location_start_datasource_hash',
      locationPrecision: 'country_centroid',
      originalLocation: event.location,
    },
  };
}

function latestTimestamp(records: NormalisedInternetOutageRecord[]): Date | null {
  return records.reduce<Date | null>((current, record) => {
    if (current === null || record.sourceUpdatedAt.getTime() > current.getTime()) {
      return record.sourceUpdatedAt;
    }
    return current;
  }, null);
}

export function normaliseInternetOutageFeed(
  body: Buffer,
  observedAt: Date,
): NormalisedInternetOutageFeed {
  if (!Buffer.isBuffer(body)) {
    throw new InternetOutageNormalisationError('IODA response body must be a Buffer');
  }
  if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime())) {
    throw new InternetOutageNormalisationError('observedAt must be a valid Date');
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(body.toString('utf8')) as unknown;
  } catch {
    throw new InternetOutageNormalisationError('Invalid IODA JSON response body');
  }

  const parsed = iodaResponseSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new InternetOutageNormalisationError('Invalid IODA outage response body');
  }

  const records = parsed.data.data.flatMap((event) => {
    const record = normaliseEvent(event, observedAt);
    return record === null ? [] : [record];
  });

  return {
    sourceId: GATECH_IODA_OUTAGES_SOURCE_ID,
    upstreamTimestamp: latestTimestamp(records),
    records,
  };
}
