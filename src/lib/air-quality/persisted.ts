import type { QueryResultRow } from 'pg';

import {
  getPersistedExecutor,
  parsePersistedTimestamp,
  requirePersistedNumber,
  type PersistedQueryExecutor,
} from '@/lib/persisted/database';
import type { PersistedDatabaseResult } from '@/lib/persisted/service';

export const AIR_QUALITY_SOURCE_ID = 'openaq-latest-pm25';
const MAX_STATIONS = 500;

export interface AirQualityStation {
  id: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  pm25: number;
  unit: string;
  level: string;
  color: string;
  lastUpdated: string;
}

export interface AirQualityResponse {
  stations: AirQualityStation[];
  total: number;
  timestamp: string;
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
  station.location_name,
  station.city,
  station.country_code,
  station.measurement_value,
  station.unit,
  station.level,
  station.observed_at,
  station.lat,
  station.lng
FROM latest_success
LEFT JOIN LATERAL (
  SELECT DISTINCT ON (source_station_id)
    location_name,
    city,
    country_code,
    measurement_value,
    unit,
    level,
    observed_at,
    ST_Y(geometry) AS lat,
    ST_X(geometry) AS lng
  FROM air_quality_observations
  WHERE source_id = $1
    AND parameter = 'pm25'
    AND observed_at >= latest_success.response_received_at - ($2::text)::interval
  ORDER BY source_station_id, observed_at DESC
  LIMIT ${MAX_STATIONS}
) AS station ON TRUE`;

interface AirQualityRow extends QueryResultRow {
  response_received_at: Date | string | null;
  upstream_timestamp: Date | string | null;
  location_name: string | null;
  city: string | null;
  country_code: string | null;
  measurement_value: number | null;
  unit: string | null;
  level: string | null;
  observed_at: Date | string | null;
  lat: number | null;
  lng: number | null;
}

// Same AQI color scale as the live route (WHO/EPA PM2.5 thresholds).
export function pm25Color(value: number): string {
  if (value > 150) return '#8B0000';
  if (value > 100) return '#FF1744';
  if (value > 55) return '#FF9500';
  if (value > 35) return '#FFD700';
  return '#00E676';
}

export function buildAirQualityResponse(stations: AirQualityStation[], now: Date): AirQualityResponse {
  return { stations, total: stations.length, timestamp: now.toISOString() };
}

function mapRow(row: AirQualityRow): AirQualityStation | null {
  if (row.location_name === null) return null;
  const value = requirePersistedNumber(row.measurement_value, `pm25 for ${row.location_name}`);
  const observedAt = parsePersistedTimestamp(row.observed_at, 'observed_at');
  return {
    id: `aq-${row.location_name}`,
    name: row.location_name,
    city: row.city ?? 'Unknown',
    country: row.country_code ?? '',
    lat: requirePersistedNumber(row.lat, `latitude for ${row.location_name}`),
    lng: requirePersistedNumber(row.lng, `longitude for ${row.location_name}`),
    pm25: value,
    unit: row.unit ?? 'µg/m³',
    level: row.level ?? 'Good',
    color: pm25Color(value),
    lastUpdated: observedAt === null ? '' : observedAt.toISOString(),
  };
}

export async function loadAirQualityDatabaseResult(
  windowMs: number,
  executor: PersistedQueryExecutor | null = getPersistedExecutor('air-quality', 'osiris-air-quality-api'),
): Promise<PersistedDatabaseResult<AirQualityStation[]> | null> {
  if (executor === null) return null;
  const result = await executor.query<AirQualityRow>(DATABASE_QUERY, [
    AIR_QUALITY_SOURCE_ID,
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
