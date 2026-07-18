import type { QueryResultRow } from 'pg';

import {
  getPersistedExecutor,
  parsePersistedTimestamp,
  requirePersistedNumber,
  type PersistedQueryExecutor,
} from '@/lib/persisted/database';
import type { PersistedDatabaseResult } from '@/lib/persisted/service';

export const FIRE_DETECTION_SOURCE_IDS = ['nasa-firms-viirs', 'nasa-firms-modis'];
export const FIRE_VOLCANO_SOURCE_ID = 'nasa-eonet-volcanoes';
const MAX_FIRES = 2000;

export interface FireMarker {
  lat: number;
  lng: number;
  brightness: number;
  confidence: string;
  date: string;
  time: string;
  frp: number;
  type: 'fire' | 'volcano';
  title?: string;
}

export interface FiresResponse {
  fires: FireMarker[];
  total: number;
  source: string;
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
  marker.kind,
  marker.lat,
  marker.lng,
  marker.brightness,
  marker.confidence,
  marker.frp,
  marker.occurred_at,
  marker.title
FROM latest_success
LEFT JOIN LATERAL (
  (
    SELECT
      'fire' AS kind,
      ST_Y(geometry) AS lat,
      ST_X(geometry) AS lng,
      brightness_kelvin AS brightness,
      confidence,
      fire_radiative_power_mw AS frp,
      occurred_at,
      NULL::text AS title
    FROM active_fire_detections
    WHERE source_id = ANY($2)
      AND occurred_at >= latest_success.response_received_at - ($3::text)::interval
    ORDER BY occurred_at DESC
    LIMIT ${MAX_FIRES}
  )
  UNION ALL
  (
    SELECT
      'volcano' AS kind,
      ST_Y(geometry) AS lat,
      ST_X(geometry) AS lng,
      NULL::double precision AS brightness,
      NULL::text AS confidence,
      NULL::double precision AS frp,
      occurred_at,
      title
    FROM disaster_events
    WHERE source_id = $4
      AND updated_at >= latest_success.response_received_at - ($3::text)::interval
    ORDER BY occurred_at DESC
    LIMIT 50
  )
) AS marker ON TRUE`;

interface FireRow extends QueryResultRow {
  response_received_at: Date | string | null;
  upstream_timestamp: Date | string | null;
  kind: string | null;
  lat: number | null;
  lng: number | null;
  brightness: number | null;
  confidence: string | null;
  frp: number | null;
  occurred_at: Date | string | null;
  title: string | null;
}

export function buildFiresResponse(fires: FireMarker[], now: Date): FiresResponse {
  return {
    fires,
    total: fires.length,
    source: 'World-State (NASA FIRMS + EONET)',
    timestamp: now.toISOString(),
  };
}

function fireDate(value: Date | null): { date: string; time: string } {
  if (value === null) return { date: '', time: '' };
  const iso = value.toISOString();
  return {
    date: iso.slice(0, 10),
    time: `${iso.slice(11, 13)}${iso.slice(14, 16)}`,
  };
}

function mapRow(row: FireRow): FireMarker | null {
  if (row.kind === null) return null;
  const occurredAt = parsePersistedTimestamp(row.occurred_at, 'occurred_at');
  const { date, time } = fireDate(occurredAt);
  const lat = requirePersistedNumber(row.lat, 'latitude');
  const lng = requirePersistedNumber(row.lng, 'longitude');

  if (row.kind === 'volcano') {
    // Same synthetic marker values the live route assigns to EONET volcanoes.
    return {
      lat,
      lng,
      brightness: 500,
      confidence: 'high',
      date,
      time: '',
      frp: 100,
      title: `[VOLCANO] ${row.title ?? 'Volcano'}`,
      type: 'volcano',
    };
  }

  return {
    lat: Math.round(lat * 1000) / 1000,
    lng: Math.round(lng * 1000) / 1000,
    brightness: row.brightness ?? 0,
    confidence: row.confidence ?? 'unknown',
    date,
    time,
    frp: row.frp ?? 0,
    type: 'fire',
  };
}

export async function loadFiresDatabaseResult(
  windowMs: number,
  executor: PersistedQueryExecutor | null = getPersistedExecutor('fires', 'osiris-fires-api'),
): Promise<PersistedDatabaseResult<FireMarker[]> | null> {
  if (executor === null) return null;
  const allSourceIds = [...FIRE_DETECTION_SOURCE_IDS, FIRE_VOLCANO_SOURCE_ID];
  const result = await executor.query<FireRow>(DATABASE_QUERY, [
    allSourceIds,
    FIRE_DETECTION_SOURCE_IDS,
    `${windowMs} milliseconds`,
    FIRE_VOLCANO_SOURCE_ID,
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
