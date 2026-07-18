import type { QueryResultRow } from 'pg';

import {
  getPersistedExecutor,
  parsePersistedTimestamp,
  requirePersistedNumber,
  type PersistedQueryExecutor,
} from '@/lib/persisted/database';
import type { PersistedDatabaseResult } from '@/lib/persisted/service';

export const RADAR_SOURCE_ID = 'gatech-ioda-outages';
const MAX_OUTAGES = 200;

export interface InternetOutage {
  id: string;
  lat: number;
  lng: number;
  country: string;
  code: string;
  score: number;
  level: string;
  from: number | null;
  until: number | null;
  datasource: string;
}

export interface RadarResponse {
  outages: InternetOutage[];
  total: number;
  timestamp: string;
  source: string;
}

const DATABASE_QUERY = `
WITH latest_success AS (
  SELECT
    response_received_at,
    upstream_timestamp
  FROM collection_runs
  WHERE source_id = $1
    AND status = 'succeeded'
    AND legacy_provenance_incomplete = FALSE
    AND response_received_at IS NOT NULL
  ORDER BY response_received_at DESC, id DESC
  LIMIT 1
)
SELECT
  latest_success.response_received_at,
  latest_success.upstream_timestamp,
  outage.country_code,
  outage.score,
  outage.severity,
  outage.datasource,
  outage.started_at,
  outage.ended_at,
  outage.lat,
  outage.lng
FROM latest_success
LEFT JOIN LATERAL (
  SELECT
    country_code,
    score,
    severity,
    datasource,
    started_at,
    ended_at,
    ST_Y(geometry) AS lat,
    ST_X(geometry) AS lng
  FROM internet_outage_observations
  WHERE source_id = $1
    AND observed_at >= latest_success.response_received_at - ($2::text)::interval
  ORDER BY started_at DESC
  LIMIT ${MAX_OUTAGES}
) AS outage ON TRUE`;

interface RadarRow extends QueryResultRow {
  response_received_at: Date | string | null;
  upstream_timestamp: Date | string | null;
  country_code: string | null;
  score: number | null;
  severity: string | null;
  datasource: string | null;
  started_at: Date | string | null;
  ended_at: Date | string | null;
  lat: number | null;
  lng: number | null;
}

export interface PersistedOutage {
  countryCode: string;
  score: number;
  severity: string;
  datasource: string;
  startedAt: Date | null;
  endedAt: Date | null;
  lat: number;
  lng: number;
}

export function buildRadarResponse(outages: PersistedOutage[], now: Date): RadarResponse {
  const mapped = outages.map((outage, index) => {
    // Same deterministic jitter as the live route so overlapping country
    // events don't stack on the map.
    const jLng = ((index * 137.5) % 200 - 100) / 100 * 2;
    const jLat = ((index * 251.3) % 200 - 100) / 100 * 2;
    return {
      id: `ioda-${outage.countryCode}-${index}`,
      lat: outage.lat + jLat,
      lng: outage.lng + jLng,
      country: outage.countryCode,
      code: outage.countryCode,
      score: outage.score,
      level: outage.severity,
      from: outage.startedAt === null ? null : Math.floor(outage.startedAt.getTime() / 1000),
      until: outage.endedAt === null ? null : Math.floor(outage.endedAt.getTime() / 1000),
      datasource: outage.datasource.replace(/_/g, ' '),
    };
  });
  return {
    outages: mapped,
    total: mapped.length,
    timestamp: now.toISOString(),
    source: 'IODA — Georgia Tech Internet Outage Detection',
  };
}

function mapRow(row: RadarRow): PersistedOutage | null {
  if (row.country_code === null) return null;
  return {
    countryCode: row.country_code,
    score: requirePersistedNumber(row.score, `score for ${row.country_code}`),
    severity: row.severity ?? 'unknown',
    datasource: row.datasource ?? '',
    startedAt: parsePersistedTimestamp(row.started_at, 'started_at'),
    endedAt: parsePersistedTimestamp(row.ended_at, 'ended_at'),
    lat: requirePersistedNumber(row.lat, `latitude for ${row.country_code}`),
    lng: requirePersistedNumber(row.lng, `longitude for ${row.country_code}`),
  };
}

export async function loadRadarDatabaseResult(
  windowMs: number,
  executor: PersistedQueryExecutor | null = getPersistedExecutor('radar', 'osiris-radar-api'),
): Promise<PersistedDatabaseResult<PersistedOutage[]> | null> {
  if (executor === null) return null;
  const result = await executor.query<RadarRow>(DATABASE_QUERY, [
    RADAR_SOURCE_ID,
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
