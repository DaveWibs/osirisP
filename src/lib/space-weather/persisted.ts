import type { QueryResultRow } from 'pg';

import {
  getPersistedExecutor,
  parsePersistedTimestamp,
  type PersistedQueryExecutor,
} from '@/lib/persisted/database';
import type { PersistedDatabaseResult } from '@/lib/persisted/service';

export const SPACE_WEATHER_SOURCE_IDS = [
  'noaa-swpc-planetary-k-index',
  'noaa-swpc-alerts',
  'noaa-swpc-xray-flares',
];

export interface SpaceWeatherAlert {
  id: string;
  issue_datetime: string;
  message: string;
}

export interface SpaceWeatherFlare {
  class: string;
  begin: string | null;
  peak: string;
  end: string | null;
}

export interface SpaceWeatherResponse {
  kp_index: number;
  storm_level: string;
  storm_color: string;
  kp_timestamp: string;
  alerts: SpaceWeatherAlert[];
  solar_flares: SpaceWeatherFlare[];
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
  observation.event_kind,
  observation.numeric_value,
  observation.classification,
  observation.message,
  observation.observed_at,
  observation.source_observation_id
FROM latest_success
LEFT JOIN LATERAL (
  (
    SELECT event_kind, numeric_value, classification, message, observed_at, source_observation_id
    FROM space_weather_observations
    WHERE event_kind = 'planetary_k_index'
    ORDER BY observed_at DESC
    LIMIT 1
  )
  UNION ALL
  (
    SELECT event_kind, numeric_value, classification, message, observed_at, source_observation_id
    FROM space_weather_observations
    WHERE event_kind = 'alert'
      AND observed_at >= latest_success.response_received_at - ($2::text)::interval
    ORDER BY observed_at DESC
    LIMIT 10
  )
  UNION ALL
  (
    SELECT event_kind, numeric_value, classification, message, observed_at, source_observation_id
    FROM space_weather_observations
    WHERE event_kind = 'xray_flare'
      AND observed_at >= latest_success.response_received_at - ($2::text)::interval
    ORDER BY observed_at DESC
    LIMIT 5
  )
) AS observation ON TRUE`;

interface SpaceWeatherRow extends QueryResultRow {
  response_received_at: Date | string | null;
  upstream_timestamp: Date | string | null;
  event_kind: string | null;
  numeric_value: number | null;
  classification: string | null;
  message: string | null;
  observed_at: Date | string | null;
  source_observation_id: string | null;
}

export interface PersistedSpaceWeatherObservation {
  eventKind: string;
  numericValue: number | null;
  classification: string | null;
  message: string | null;
  observedAt: Date | null;
  sourceObservationId: string;
}

// Same storm-level scale as the live route.
export function stormLevel(kpIndex: number): { level: string; color: string } {
  if (kpIndex >= 8) return { level: 'Extreme (G5)', color: '#FF1744' };
  if (kpIndex >= 7) return { level: 'Severe (G4)', color: '#FF3D3D' };
  if (kpIndex >= 6) return { level: 'Strong (G3)', color: '#FF9500' };
  if (kpIndex >= 5) return { level: 'Moderate (G2)', color: '#FFD700' };
  if (kpIndex >= 4) return { level: 'Minor (G1)', color: '#FFD700' };
  if (kpIndex >= 3) return { level: 'Unsettled', color: '#D4AF37' };
  return { level: 'Quiet', color: '#00E676' };
}

export function buildSpaceWeatherResponse(
  observations: PersistedSpaceWeatherObservation[],
  now: Date,
): SpaceWeatherResponse {
  const kp = observations.find((observation) => observation.eventKind === 'planetary_k_index');
  const kpIndex = kp?.numericValue ?? 0;
  const storm = stormLevel(kpIndex);

  const alerts = observations
    .filter((observation) => observation.eventKind === 'alert')
    .map((observation) => ({
      id: observation.classification ?? observation.sourceObservationId,
      issue_datetime: observation.observedAt === null ? '' : observation.observedAt.toISOString(),
      message: (observation.message ?? '').substring(0, 200),
    }));

  // The persisted flare capture keys observations by peak time, so begin/end
  // remain in the archived raw payload rather than the normalised row.
  const solarFlares = observations
    .filter((observation) => observation.eventKind === 'xray_flare' && observation.classification !== null)
    .map((observation) => ({
      class: observation.classification as string,
      begin: null,
      peak: observation.observedAt === null ? '' : observation.observedAt.toISOString(),
      end: null,
    }));

  return {
    kp_index: kpIndex,
    storm_level: storm.level,
    storm_color: storm.color,
    kp_timestamp: kp?.observedAt ? kp.observedAt.toISOString() : '',
    alerts,
    solar_flares: solarFlares,
    timestamp: now.toISOString(),
  };
}

function mapRow(row: SpaceWeatherRow): PersistedSpaceWeatherObservation | null {
  if (row.event_kind === null || row.source_observation_id === null) return null;
  return {
    eventKind: row.event_kind,
    numericValue: row.numeric_value,
    classification: row.classification,
    message: row.message,
    observedAt: parsePersistedTimestamp(row.observed_at, 'observed_at'),
    sourceObservationId: row.source_observation_id,
  };
}

export async function loadSpaceWeatherDatabaseResult(
  windowMs: number,
  executor: PersistedQueryExecutor | null = getPersistedExecutor('space-weather', 'osiris-space-weather-api'),
): Promise<PersistedDatabaseResult<PersistedSpaceWeatherObservation[]> | null> {
  if (executor === null) return null;
  const result = await executor.query<SpaceWeatherRow>(DATABASE_QUERY, [
    SPACE_WEATHER_SOURCE_IDS,
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
