import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { z } from 'zod';

export const AIRPLANES_LIVE_MILITARY_SOURCE_ID = 'airplanes-live-military' as const;
export const ADSB_LOL_MILITARY_SOURCE_ID = 'adsb-lol-military' as const;

export type AdsbAircraftSourceId =
  | typeof AIRPLANES_LIVE_MILITARY_SOURCE_ID
  | typeof ADSB_LOL_MILITARY_SOURCE_ID;

const SOURCE_METADATA = {
  [AIRPLANES_LIVE_MILITARY_SOURCE_ID]: { provider: 'airplanes.live' },
  [ADSB_LOL_MILITARY_SOURCE_ID]: { provider: 'adsb.lol' },
} as const;

const finiteNumberSchema = z.number().refine(Number.isFinite, 'must be finite');

const adsbAircraftSchema = z
  .object({
    hex: z.string().min(1),
    flight: z.string().optional().nullable(),
    lat: finiteNumberSchema.optional().nullable(),
    lon: finiteNumberSchema.optional().nullable(),
    alt_baro: z.union([finiteNumberSchema, z.string()]).optional().nullable(),
    gs: finiteNumberSchema.optional().nullable(),
    track: finiteNumberSchema.optional().nullable(),
    squawk: z.string().optional().nullable(),
    t: z.string().optional().nullable(),
    r: z.string().optional().nullable(),
    dbFlags: z.number().int().optional().nullable(),
    seen_pos: finiteNumberSchema.optional().nullable(),
    seen: finiteNumberSchema.optional().nullable(),
    nac_p: z.number().int().optional().nullable(),
  })
  .passthrough();

const adsbResponseSchema = z
  .object({
    ac: z.array(adsbAircraftSchema).default([]),
    now: z.union([finiteNumberSchema, z.string()]).optional(),
    total: z.number().int().optional(),
  })
  .passthrough();

type AdsbAircraft = z.infer<typeof adsbAircraftSchema>;

export interface NormalisedAdsbAircraftRecord {
  sourceId: AdsbAircraftSourceId;
  sourceAircraftId: string;
  observedAt: Date;
  sourceUpdatedAt: Date;
  icao24: string;
  callsign: string | null;
  registration: string | null;
  aircraftType: string | null;
  latitude: number;
  longitude: number;
  altitudeMeters: number | null;
  speedKnots: number | null;
  heading: number | null;
  squawk: string | null;
  nacP: number | null;
  militaryFlag: boolean;
  contentHash: string;
  evidenceClassification: 'observed';
  rawPayload: unknown;
  metadata: {
    provider: 'airplanes.live' | 'adsb.lol';
    format: 'json';
    aircraft_content_hash: string;
    stableIdentifierSource: 'icao24';
    [key: string]: unknown;
  };
}

export interface NormalisedAdsbAircraftFeed {
  sourceId: AdsbAircraftSourceId;
  upstreamTimestamp: Date | null;
  records: NormalisedAdsbAircraftRecord[];
}

export class AdsbAircraftNormalisationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdsbAircraftNormalisationError';
  }
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function parseProviderNow(value: string | number | undefined, fallback: Date): Date {
  if (value === undefined) return fallback;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const milliseconds = numeric > 10_000_000_000 ? numeric : numeric * 1000;
  const parsed = new Date(milliseconds);
  return Number.isFinite(parsed.getTime()) ? parsed : fallback;
}

function altitudeMeters(value: string | number | null | undefined): number | null {
  if (typeof value !== 'number') return null;
  return Math.round(value * 0.3048);
}

function trimmed(value: string | null | undefined): string | null {
  const clean = value?.trim();
  return clean === undefined || clean.length === 0 ? null : clean;
}

function normaliseAircraft(
  aircraft: AdsbAircraft,
  sourceId: AdsbAircraftSourceId,
  observedAt: Date,
): NormalisedAdsbAircraftRecord | null {
  if (aircraft.lat === undefined || aircraft.lat === null) return null;
  if (aircraft.lon === undefined || aircraft.lon === null) return null;
  const icao24 = aircraft.hex.trim().toLowerCase();
  if (!/^[0-9a-f]{6}$/u.test(icao24)) return null;

  const contentHash = hashJson(aircraft);
  const source = SOURCE_METADATA[sourceId];
  return {
    sourceId,
    sourceAircraftId: icao24,
    observedAt,
    sourceUpdatedAt: observedAt,
    icao24,
    callsign: trimmed(aircraft.flight),
    registration: trimmed(aircraft.r),
    aircraftType: trimmed(aircraft.t),
    latitude: Math.round(aircraft.lat * 100_000) / 100_000,
    longitude: Math.round(aircraft.lon * 100_000) / 100_000,
    altitudeMeters: altitudeMeters(aircraft.alt_baro),
    speedKnots: aircraft.gs ?? null,
    heading: aircraft.track ?? null,
    squawk: trimmed(aircraft.squawk),
    nacP: aircraft.nac_p ?? null,
    militaryFlag: true,
    contentHash,
    evidenceClassification: 'observed',
    rawPayload: aircraft,
    metadata: {
      provider: source.provider,
      format: 'json',
      aircraft_content_hash: contentHash,
      stableIdentifierSource: 'icao24',
      seenSeconds: aircraft.seen ?? null,
      seenPositionSeconds: aircraft.seen_pos ?? null,
      dbFlags: aircraft.dbFlags ?? null,
    },
  };
}

function latestTimestamp(records: NormalisedAdsbAircraftRecord[]): Date | null {
  return records.reduce<Date | null>((current, record) => {
    if (current === null || record.sourceUpdatedAt.getTime() > current.getTime()) {
      return record.sourceUpdatedAt;
    }
    return current;
  }, null);
}

export function normaliseAdsbAircraftFeed(
  body: Buffer,
  sourceId: AdsbAircraftSourceId,
  observedAt: Date,
): NormalisedAdsbAircraftFeed {
  if (!Buffer.isBuffer(body)) {
    throw new AdsbAircraftNormalisationError('ADS-B response body must be a Buffer');
  }
  if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime())) {
    throw new AdsbAircraftNormalisationError('observedAt must be a valid Date');
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(body.toString('utf8')) as unknown;
  } catch {
    throw new AdsbAircraftNormalisationError('Invalid ADS-B JSON response body');
  }

  const parsed = adsbResponseSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new AdsbAircraftNormalisationError('Invalid ADS-B aircraft response body');
  }

  const providerTime = parseProviderNow(parsed.data.now, observedAt);
  const records = parsed.data.ac.flatMap((aircraft) => {
    const record = normaliseAircraft(aircraft, sourceId, providerTime);
    return record === null ? [] : [record];
  });

  return {
    sourceId,
    upstreamTimestamp: latestTimestamp(records),
    records,
  };
}
