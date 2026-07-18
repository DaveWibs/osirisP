import type { QueryResultRow } from 'pg';

import {
  getPersistedExecutor,
  parsePersistedTimestamp,
  requirePersistedNumber,
  type PersistedQueryExecutor,
} from '@/lib/persisted/database';
import type { PersistedDatabaseResult } from '@/lib/persisted/service';

export const WEATHER_SOURCE_IDS = ['nasa-eonet-weather', 'noaa-nws-alerts', 'gdacs-disasters'];
const MAX_EVENTS = 300;

export type WeatherSeverity = 'low' | 'medium' | 'high';

export interface WeatherEventItem {
  id: string;
  title: string;
  category: string;
  type: string;
  icon: string;
  severity: WeatherSeverity;
  lat: number;
  lng: number;
  date?: string;
  expires?: string;
  area?: string;
  source: string;
  provider: 'NASA EONET' | 'NOAA/NWS' | 'GDACS';
}

export interface WeatherResponse {
  events: WeatherEventItem[];
  total: number;
  timestamp: string;
}

const DATABASE_QUERY = `
WITH latest_per_source AS (
  SELECT DISTINCT ON (source_id)
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
  event.source_id,
  event.source_event_id,
  event.title,
  event.category,
  event.event_type,
  event.severity,
  event.area,
  event.expires_at,
  event.link,
  event.occurred_at,
  event.lat,
  event.lng
FROM latest_success
LEFT JOIN LATERAL (
  SELECT
    source_id,
    source_event_id,
    title,
    category,
    event_type,
    severity,
    area,
    expires_at,
    link,
    occurred_at,
    ST_Y(geometry) AS lat,
    ST_X(geometry) AS lng
  FROM weather_events
  WHERE source_id = ANY($1)
    AND updated_at >= latest_success.response_received_at - ($2::text)::interval
  UNION ALL
  SELECT
    source_id,
    source_event_id,
    title,
    'gdacs' AS category,
    CASE event_type
      WHEN 'TC' THEN 'Tropical Cyclone'
      WHEN 'FL' THEN 'Flood'
      WHEN 'DR' THEN 'Drought'
      ELSE event_type
    END AS event_type,
    CASE alert_level
      WHEN 'red' THEN 'high'
      WHEN 'orange' THEN 'medium'
      ELSE 'low'
    END AS severity,
    metadata->>'country' AS area,
    NULL::TIMESTAMPTZ AS expires_at,
    link,
    occurred_at,
    ST_Y(geometry) AS lat,
    ST_X(geometry) AS lng
  FROM disaster_events
  WHERE source_id = 'gdacs-disasters'
    AND event_type IN ('TC', 'FL', 'DR')
    AND updated_at >= latest_success.response_received_at - ($2::text)::interval
  ORDER BY occurred_at DESC
  LIMIT ${MAX_EVENTS}
) AS event ON TRUE`;

interface WeatherRow extends QueryResultRow {
  response_received_at: Date | string | null;
  upstream_timestamp: Date | string | null;
  source_id: string | null;
  source_event_id: string | null;
  title: string | null;
  category: string | null;
  event_type: string | null;
  severity: string | null;
  area: string | null;
  expires_at: Date | string | null;
  link: string | null;
  occurred_at: Date | string | null;
  lat: number | null;
  lng: number | null;
}

// Same icon mapping as the live route's category handling.
export function weatherIcon(category: string): string {
  if (category === 'severeStorms') return 'cyclone';
  if (category === 'volcanoes') return 'volcano';
  if (category === 'seaIce') return 'ice';
  if (category === 'weatherAlerts') return 'weather';
  if (category === 'gdacs') return 'alert';
  return 'alert';
}

function gdacsIcon(type: string | null): string {
  if (type === 'Tropical Cyclone') return 'cyclone';
  if (type === 'Flood') return 'flood';
  if (type === 'Drought') return 'drought';
  return 'alert';
}

function weatherSeverity(value: string | null): WeatherSeverity {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'low';
}

export function buildWeatherResponse(events: WeatherEventItem[], now: Date): WeatherResponse {
  return { events, total: events.length, timestamp: now.toISOString() };
}

function mapRow(row: WeatherRow): WeatherEventItem | null {
  if (row.source_id === null || row.source_event_id === null || row.title === null) return null;
  const isNws = row.source_id === 'noaa-nws-alerts';
  const isGdacs = row.source_id === 'gdacs-disasters';
  const occurredAt = parsePersistedTimestamp(row.occurred_at, 'occurred_at');
  const expiresAt = parsePersistedTimestamp(row.expires_at, 'expires_at');
  const category = row.category ?? 'unknown';
  const type = row.event_type ?? 'Event';

  return {
    id: `${isGdacs ? 'gdacs' : isNws ? 'nws' : 'eonet'}-${row.source_event_id}`,
    title: row.title,
    category,
    type,
    icon: isGdacs ? gdacsIcon(type) : weatherIcon(category),
    severity: weatherSeverity(row.severity),
    lat: requirePersistedNumber(row.lat, `latitude for ${row.source_event_id}`),
    lng: requirePersistedNumber(row.lng, `longitude for ${row.source_event_id}`),
    date: occurredAt === undefined || occurredAt === null ? undefined : occurredAt.toISOString(),
    expires: expiresAt === null ? undefined : expiresAt.toISOString(),
    area: row.area ?? undefined,
    source: row.link ?? (isGdacs ? 'https://www.gdacs.org/' : isNws ? 'https://api.weather.gov/alerts/active' : 'NASA EONET'),
    provider: isGdacs ? 'GDACS' : isNws ? 'NOAA/NWS' : 'NASA EONET',
  };
}

export async function loadWeatherDatabaseResult(
  windowMs: number,
  executor: PersistedQueryExecutor | null = getPersistedExecutor('weather', 'osiris-weather-api'),
): Promise<PersistedDatabaseResult<WeatherEventItem[]> | null> {
  if (executor === null) return null;
  const result = await executor.query<WeatherRow>(DATABASE_QUERY, [
    WEATHER_SOURCE_IDS,
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
