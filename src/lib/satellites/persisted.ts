import type { QueryResultRow } from 'pg';

import {
  getPersistedExecutor,
  parsePersistedTimestamp,
  requirePersistedNumber,
  type PersistedQueryExecutor,
} from '@/lib/persisted/database';
import type { PersistedDatabaseResult } from '@/lib/persisted/service';

export const SATELLITE_SOURCE_IDS = [
  'celestrak-active-tle',
  'celestrak-starlink-supplemental-tle',
  'satnogs-tle',
];

export interface SatellitePosition {
  name: string;
  lat: number;
  lng: number;
  alt: number;
  mission: string;
  color: string;
  category: string;
  noradId: string;
}

export interface SatelliteResponse {
  satellites: SatellitePosition[];
  total: number;
  category_counts: Record<string, number>;
  source: string;
  raw_count: number;
  timestamp: string;
}

export interface PersistedSatelliteTle {
  name: string;
  line1: string;
  line2: string;
  noradId: number;
}

const DATABASE_QUERY = `
WITH latest_per_source AS (
  SELECT DISTINCT ON (source_id)
    source_id,
    response_received_at,
    upstream_timestamp
  FROM collection_runs
  WHERE source_id = ANY($1)
    AND status = 'succeeded'
    AND legacy_provenance_incomplete = FALSE
    AND response_received_at IS NOT NULL
  ORDER BY source_id, response_received_at DESC, id DESC
),
latest_success AS (
  SELECT
    MAX(response_received_at) AS response_received_at,
    MAX(upstream_timestamp) AS upstream_timestamp
  FROM latest_per_source
)
SELECT
  latest_success.response_received_at,
  latest_success.upstream_timestamp,
  tle.name,
  tle.line1,
  tle.line2,
  tle.norad_id
FROM latest_success
LEFT JOIN LATERAL (
  SELECT DISTINCT ON (norad_id)
    name,
    line1,
    line2,
    norad_id,
    normalised_at
  FROM satellite_tle_observations
  WHERE source_id = ANY($1)
    AND normalised_at >= latest_success.response_received_at - ($2::text)::interval
  ORDER BY norad_id, normalised_at DESC
) AS tle ON TRUE`;

interface SatelliteRow extends QueryResultRow {
  response_received_at: Date | string | null;
  upstream_timestamp: Date | string | null;
  name: string | null;
  line1: string | null;
  line2: string | null;
  norad_id: number | null;
}

const MISSION_CLASSIFY: Record<string, { mission: string; color: string }> = {
  USA: { mission: 'Military Recon', color: '#FF3D3D' },
  NROL: { mission: 'NRO Classified', color: '#FF3D3D' },
  LACROSSE: { mission: 'SAR Imaging', color: '#00E5FF' },
  MENTOR: { mission: 'SIGINT', color: '#FFFFFF' },
  ORION: { mission: 'SIGINT', color: '#FFFFFF' },
  TRUMPET: { mission: 'SIGINT', color: '#FFFFFF' },
  GPS: { mission: 'Navigation', color: '#448AFF' },
  NAVSTAR: { mission: 'Navigation', color: '#448AFF' },
  GLONASS: { mission: 'Navigation', color: '#448AFF' },
  GALILEO: { mission: 'Navigation', color: '#448AFF' },
  BEIDOU: { mission: 'Navigation', color: '#448AFF' },
  SBIRS: { mission: 'Early Warning', color: '#FF00FF' },
  DSP: { mission: 'Early Warning', color: '#FF00FF' },
  STARLINK: { mission: 'Commercial Comms', color: '#00E676' },
  ONEWEB: { mission: 'Commercial Comms', color: '#00E676' },
  PLANET: { mission: 'Commercial Imaging', color: '#00E676' },
  WORLDVIEW: { mission: 'Commercial Imaging', color: '#00E676' },
  ISS: { mission: 'Space Station', color: '#FFD700' },
  TIANGONG: { mission: 'Space Station', color: '#FFD700' },
  COSMOS: { mission: 'Russian Military', color: '#FF6B6B' },
  YAOGAN: { mission: 'Chinese Recon', color: '#FF6B6B' },
  FENGYUN: { mission: 'Weather', color: '#87CEEB' },
  GOES: { mission: 'Weather', color: '#87CEEB' },
  NOAA: { mission: 'Weather', color: '#87CEEB' },
  METEOSAT: { mission: 'Weather', color: '#87CEEB' },
  LANDSAT: { mission: 'Earth Observation', color: '#90EE90' },
  SENTINEL: { mission: 'Earth Observation', color: '#90EE90' },
  TERRA: { mission: 'Earth Science', color: '#90EE90' },
  AQUA: { mission: 'Earth Science', color: '#90EE90' },
  HUBBLE: { mission: 'Space Telescope', color: '#FFD700' },
  'JAMES WEBB': { mission: 'Space Telescope', color: '#FFD700' },
};

export function classifySatellite(name: string): { mission: string; color: string } {
  const upper = name.toUpperCase();
  for (const [keyword, info] of Object.entries(MISSION_CLASSIFY)) {
    if (upper.includes(keyword)) return info;
  }
  return { mission: 'Unknown', color: '#00E5FF' };
}

function gmst(jd: number): number {
  const t = (jd - 2451545.0) / 36525.0;
  const gmstSec = 67310.54841 + (876600.0 * 3600 + 8640184.812866) * t + 0.093104 * t * t - 6.2e-6 * t * t * t;
  return ((gmstSec % 86400) / 86400.0) * 2 * Math.PI;
}

export function propagateSGP4Simple(
  line1: string,
  line2: string,
  now = new Date(),
): { lat: number; lng: number; alt: number } | null {
  try {
    const incDeg = parseFloat(line2.substring(8, 16));
    const raanDeg = parseFloat(line2.substring(17, 25));
    const ecc = parseFloat(`0.${line2.substring(26, 33).trim()}`);
    const argPerDeg = parseFloat(line2.substring(34, 42));
    const meanAnomDeg = parseFloat(line2.substring(43, 51));
    const meanMotion = parseFloat(line2.substring(52, 63));

    if (Number.isNaN(meanMotion) || meanMotion === 0) return null;

    const epochYear = parseInt(line1.substring(18, 20), 10);
    const epochDay = parseFloat(line1.substring(20, 32));
    const fullYear = epochYear > 56 ? 1900 + epochYear : 2000 + epochYear;
    const epochDate = new Date(fullYear, 0, 1);
    epochDate.setDate(epochDate.getDate() + epochDay - 1);
    const elapsedMin = (now.getTime() - epochDate.getTime()) / 60000;

    if (Math.abs(elapsedMin) > 129600 && !line1.includes('27885-3')) return null;

    const n = meanMotion * 2 * Math.PI / 1440;
    const m = ((meanAnomDeg * Math.PI / 180) + n * elapsedMin) % (2 * Math.PI);

    let e = m;
    for (let j = 0; j < 10; j += 1) {
      e = m + ecc * Math.sin(e);
    }

    const sinV = Math.sqrt(1 - ecc * ecc) * Math.sin(e) / (1 - ecc * Math.cos(e));
    const cosV = (Math.cos(e) - ecc) / (1 - ecc * Math.cos(e));
    const v = Math.atan2(sinV, cosV);

    const a = (398600.4418 / (meanMotion * 2 * Math.PI / 86400) ** 2) ** (1 / 3);
    const r = a * (1 - ecc * Math.cos(e));

    const inc = incDeg * Math.PI / 180;
    const raan = raanDeg * Math.PI / 180;
    const argPer = argPerDeg * Math.PI / 180;
    const u = v + argPer;

    const x = r * (Math.cos(raan) * Math.cos(u) - Math.sin(raan) * Math.sin(u) * Math.cos(inc));
    const y = r * (Math.sin(raan) * Math.cos(u) + Math.cos(raan) * Math.sin(u) * Math.cos(inc));
    const z = r * Math.sin(u) * Math.sin(inc);

    const jd = 2440587.5 + now.getTime() / 86400000;
    const theta = gmst(jd);

    const xRot = x * Math.cos(theta) + y * Math.sin(theta);
    const yRot = -x * Math.sin(theta) + y * Math.cos(theta);

    const lng = Math.atan2(yRot, xRot) * 180 / Math.PI;
    const lat = Math.atan2(z, Math.sqrt(xRot * xRot + yRot * yRot)) * 180 / Math.PI;
    const alt = r - 6371;

    if (Number.isNaN(lat) || Number.isNaN(lng) || Math.abs(lat) > 90) return null;
    if (alt < 100 || alt > 50000) return null;

    return {
      lat: Math.round(lat * 10000) / 10000,
      lng: Math.round(((lng + 540) % 360 - 180) * 10000) / 10000,
      alt: Math.round(alt),
    };
  } catch {
    return null;
  }
}

export function satelliteCategory(name: string, mission: string): string {
  const upperName = name.toUpperCase();
  if (upperName.includes(' DEB') || upperName.includes('DEBRIS') || upperName.includes(' R/B')) return 'other';
  if (mission === 'Commercial Comms' || mission === 'Commercial Imaging') return 'comms';
  if (mission === 'Navigation') return 'navigation';
  if (mission === 'Weather' || mission === 'Earth Observation' || mission === 'Earth Science') return 'earth_obs';
  if (
    mission === 'Military Recon'
    || mission === 'NRO Classified'
    || mission === 'SIGINT'
    || mission === 'Early Warning'
    || mission === 'Russian Military'
    || mission === 'Chinese Recon'
    || mission === 'SAR Imaging'
  ) return 'military';
  if (mission === 'Space Station' || mission === 'Space Telescope') return 'science';
  return 'other';
}

export function buildSatelliteResponse(tles: PersistedSatelliteTle[], now: Date): SatelliteResponse {
  const satellites: SatellitePosition[] = [];
  for (const tle of tles) {
    const pos = propagateSGP4Simple(tle.line1, tle.line2, now);
    if (pos === null) continue;
    const classification = classifySatellite(tle.name);
    satellites.push({
      name: tle.name,
      lat: pos.lat,
      lng: pos.lng,
      alt: pos.alt,
      mission: classification.mission,
      color: classification.color,
      category: satelliteCategory(tle.name, classification.mission),
      noradId: `${tle.noradId}`,
    });
  }

  const categoryCounts: Record<string, number> = {};
  for (const satellite of satellites) {
    categoryCounts[satellite.category] = (categoryCounts[satellite.category] ?? 0) + 1;
  }

  return {
    satellites,
    total: satellites.length,
    category_counts: categoryCounts,
    source: `worldstate-database (${tles.length} persisted TLEs)`,
    raw_count: tles.length,
    timestamp: now.toISOString(),
  };
}

function mapRow(row: SatelliteRow): PersistedSatelliteTle | null {
  if (row.name === null || row.line1 === null || row.line2 === null || row.norad_id === null) return null;
  return {
    name: row.name,
    line1: row.line1,
    line2: row.line2,
    noradId: requirePersistedNumber(row.norad_id, `NORAD ID for ${row.name}`),
  };
}

export async function loadSatelliteDatabaseResult(
  windowMs: number,
  executor: PersistedQueryExecutor | null = getPersistedExecutor('satellites', 'osiris-satellites-api'),
): Promise<PersistedDatabaseResult<PersistedSatelliteTle[]> | null> {
  if (executor === null) return null;
  const result = await executor.query<SatelliteRow>(DATABASE_QUERY, [
    SATELLITE_SOURCE_IDS,
    `${windowMs} milliseconds`,
  ]);
  return {
    rows: result.rows.flatMap((row) => {
      const mapped = mapRow(row);
      return mapped === null ? [] : [mapped];
    }),
    responseReceivedAt: parsePersistedTimestamp(result.rows[0]?.response_received_at, 'response-received'),
    upstreamTimestamp: parsePersistedTimestamp(result.rows[0]?.upstream_timestamp, 'upstream'),
  };
}
