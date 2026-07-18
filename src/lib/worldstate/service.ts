import { randomUUID } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import {
  type WorldStateAlertKind,
  type WorldStateAlertSeverity,
  type WorldStateAlertStatus,
  type WorldStateAlertsResponse,
  type WorldStateCoverageBounds,
  type WorldStateCoverageCategory,
  type WorldStateCoverageResponse,
  type WorldStateCoverageSource,
  type WorldStateCoverageTimelineBucket,
  type WorldStateEvidenceClassification,
  type WorldStateEvidenceEdge,
  type WorldStateEvidenceNode,
  type WorldStateEvidenceNodeType,
  type WorldStateEvidenceRelationType,
  type WorldStateEvidenceResponse,
  type WorldStateEvent,
  type WorldStateEventCategory,
  type WorldStateEventsResponse,
  type WorldStateEventDetailResponse,
  type WorldStateMarketQuote,
  type WorldStateMarketQuotesResponse,
  type WorldStateIntelligenceAlert,
  type WorldStateOperationsAlert,
  type WorldStateOperationsAlertsResponse,
  type WorldStateOperationsAlertSeverity,
  type WorldStateOperationsSourceHealth,
  type WorldStateOperationsStatusCount,
  type WorldStateOperationsSummaryResponse,
  type WorldStateOperationsTotals,
  type WorldStateCollectorDiagnosticsResponse,
  type WorldStateCollectorFailingSource,
  type WorldStateCollectorFailureRun,
  type WorldStateReadinessCheck,
  type WorldStateReadinessResponse,
  type WorldStateReadinessSummary,
  type WorldStateReadinessStatus,
  type WorldStateRawObservation,
  type WorldStateRawObservationSummary,
  type WorldStateRawObservationResponse,
  type WorldStateCollectionRun,
  type WorldStateCollectionRunListItem,
  type WorldStateCollectionRunSummary,
  type WorldStateCollectionRunListResponse,
  type WorldStateCollectionRunResponse,
  type WorldStateCollectionRunsResponse,
  type WorldStateRunRawObservationsResponse,
  type WorldStateSourceDetailResponse,
  type WorldStateSourceSummary,
  type WorldStateSourcesResponse,
  type WorldStateRefreshAlertsResponse,
} from './contract';
import type { WorldStateQueryExecutor } from './database';

export interface WorldStateEventQuery {
  categories?: WorldStateEventCategory[];
  sourceIds?: string[];
  since?: Date;
  until?: Date;
  bbox?: [number, number, number, number];
  limit?: number;
  cursor?: string;
}

export interface WorldStateMarketQuoteQuery {
  symbols?: string[];
  quoteTypes?: string[];
  sourceIds?: string[];
  since?: Date;
  limit?: number;
  cursor?: string;
}

export interface WorldStateCollectionRunQuery {
  limit?: number;
  cursor?: string;
}

export interface WorldStateCollectionRunsQuery {
  sourceIds?: string[];
  statuses?: string[];
  since?: Date;
  until?: Date;
  limit?: number;
  cursor?: string;
}

export interface WorldStateRunRawObservationQuery {
  limit?: number;
  cursor?: string;
}

export interface WorldStateOperationsSummaryQuery {
  since?: Date;
}

export interface WorldStateOperationsAlertsQuery {
  since?: Date;
}

export interface WorldStateCoverageQuery {
  since?: Date;
  until?: Date;
}

export interface WorldStateCollectorDiagnosticsQuery {
  since?: Date;
  limit?: number;
}

export interface WorldStateAlertsQuery {
  since?: Date;
  statuses?: string[];
  severities?: string[];
  kinds?: string[];
  limit?: number;
  cursor?: string;
}

export interface WorldStateRefreshAlertsQuery {
  since?: Date;
  minSamples?: number;
  thresholdPercent?: number;
}

export interface WorldStateEvidenceQuery {
  nodeKey?: string;
  fromNodeKey?: string;
  toNodeKey?: string;
  relationTypes?: string[];
  sourceIds?: string[];
  evidenceClassifications?: string[];
  limit?: number;
  cursor?: string;
}

const EVENT_CATEGORIES = new Set<WorldStateEventCategory>([
  'seismic',
  'disaster',
  'fire',
  'weather',
  'air_quality',
  'internet_outage',
  'aviation',
]);

const DEFAULT_EVENT_CATEGORIES: WorldStateEventCategory[] = [
  'seismic',
  'disaster',
  'fire',
  'weather',
  'air_quality',
  'internet_outage',
  'aviation',
];

const EVIDENCE_CLASSIFICATIONS = new Set<WorldStateEvidenceClassification>([
  'observed',
  'reported',
  'derived',
  'inferred',
  'hypothesis',
]);

const EVIDENCE_RELATION_TYPES = new Set<WorldStateEvidenceRelationType>([
  'derived_from',
  'supported_by',
  'located_in',
  'affects',
  'associated_with',
  'hypothesizes',
  'source_observed',
]);

const EXPECTED_MIGRATION_COUNT = 24;
const EXPECTED_LATEST_MIGRATION = '0024_evidence_chain_graph';
const MARKET_ANOMALY_CALCULATION_VERSION = 'market-price-movement-v1';
const MARKET_ANOMALY_METHOD = 'median-baseline-percent-move-with-mad-context';

const EVENT_UNION_SQL = `
WITH event_rows AS (
  SELECT
    event.id::text AS id,
    'seismic'::text AS category,
    COALESCE(event.event_type, 'earthquake') AS event_type,
    event.source_id,
    event.source_event_id AS source_record_id,
    COALESCE(event.place, 'Seismic event') AS title,
    NULL::text AS description,
    event.occurred_at,
    event.updated_at,
    raw.observed_at,
    CASE
      WHEN event.magnitude >= 7 THEN 'critical'
      WHEN event.magnitude >= 5 THEN 'high'
      WHEN event.magnitude >= 3 THEN 'medium'
      ELSE 'low'
    END AS severity,
    ST_Y(event.geometry)::double precision AS latitude,
    ST_X(event.geometry)::double precision AS longitude,
    event.evidence_classification,
    event.parser_version,
    jsonb_build_object(
      'magnitude', event.magnitude,
      'depthKm', event.depth_km,
      'tsunami', event.tsunami,
      'felt', event.felt,
      'alert', event.alert
    ) AS facts,
    event.metadata,
    event.raw_observation_id::text,
    raw.collection_run_id::text,
    raw.archive_path,
    raw.content_hash
  FROM seismic_events AS event
  INNER JOIN raw_observations AS raw
    ON raw.id = event.raw_observation_id
   AND raw.source_id = event.source_id

  UNION ALL

  SELECT
    event.id::text,
    'disaster'::text,
    event.event_type,
    event.source_id,
    event.source_event_id,
    event.title,
    event.description,
    event.occurred_at,
    event.updated_at,
    raw.observed_at,
    COALESCE(event.metadata ->> 'alertLevel', event.metadata ->> 'severity', 'medium'),
    ST_Y(event.geometry)::double precision,
    ST_X(event.geometry)::double precision,
    event.evidence_classification,
    event.parser_version,
    jsonb_build_object('link', event.link, 'eventType', event.event_type),
    event.metadata,
    event.raw_observation_id::text,
    raw.collection_run_id::text,
    raw.archive_path,
    raw.content_hash
  FROM disaster_events AS event
  INNER JOIN raw_observations AS raw
    ON raw.id = event.raw_observation_id
   AND raw.source_id = event.source_id

  UNION ALL

  SELECT
    event.id::text,
    'fire'::text,
    'active_fire',
    event.source_id,
    event.source_detection_id,
    COALESCE(event.metadata ->> 'title', CONCAT('Active fire ', event.source_detection_id)),
    NULL::text,
    event.occurred_at,
    event.updated_at,
    raw.observed_at,
    CASE
      WHEN event.fire_radiative_power_mw >= 100 THEN 'high'
      WHEN event.fire_radiative_power_mw >= 30 THEN 'medium'
      ELSE 'low'
    END,
    ST_Y(event.geometry)::double precision,
    ST_X(event.geometry)::double precision,
    event.evidence_classification,
    event.parser_version,
    jsonb_build_object(
      'satellite', event.satellite,
      'instrument', event.instrument,
      'confidence', event.confidence,
      'brightnessKelvin', event.brightness_kelvin,
      'fireRadiativePowerMw', event.fire_radiative_power_mw,
      'daynight', event.daynight
    ),
    event.metadata,
    event.raw_observation_id::text,
    raw.collection_run_id::text,
    raw.archive_path,
    raw.content_hash
  FROM active_fire_detections AS event
  INNER JOIN raw_observations AS raw
    ON raw.id = event.raw_observation_id
   AND raw.source_id = event.source_id

  UNION ALL

  SELECT
    event.id::text,
    'weather'::text,
    event.event_type,
    event.source_id,
    event.source_event_id,
    event.title,
    event.area,
    event.occurred_at,
    event.updated_at,
    raw.observed_at,
    event.severity,
    ST_Y(event.geometry)::double precision,
    ST_X(event.geometry)::double precision,
    event.evidence_classification,
    event.parser_version,
    jsonb_build_object(
      'category', event.category,
      'area', event.area,
      'expiresAt', event.expires_at,
      'link', event.link
    ),
    event.metadata,
    event.raw_observation_id::text,
    raw.collection_run_id::text,
    raw.archive_path,
    raw.content_hash
  FROM weather_events AS event
  INNER JOIN raw_observations AS raw
    ON raw.id = event.raw_observation_id
   AND raw.source_id = event.source_id

  UNION ALL

  SELECT
    event.id::text,
    'air_quality'::text,
    'pm25',
    event.source_id,
    event.source_station_id,
    event.location_name,
    COALESCE(event.city, event.country_code),
    event.observed_at AS occurred_at,
    event.updated_at,
    raw.observed_at,
    event.level,
    ST_Y(event.geometry)::double precision,
    ST_X(event.geometry)::double precision,
    event.evidence_classification,
    event.parser_version,
    jsonb_build_object(
      'city', event.city,
      'countryCode', event.country_code,
      'parameter', event.parameter,
      'measurementValue', event.measurement_value,
      'unit', event.unit
    ),
    event.metadata,
    event.raw_observation_id::text,
    raw.collection_run_id::text,
    raw.archive_path,
    raw.content_hash
  FROM air_quality_observations AS event
  INNER JOIN raw_observations AS raw
    ON raw.id = event.raw_observation_id
   AND raw.source_id = event.source_id

  UNION ALL

  SELECT
    event.id::text,
    'internet_outage'::text,
    'internet_outage',
    event.source_id,
    event.source_event_id,
    CONCAT('Internet outage ', event.country_code),
    event.datasource,
    event.started_at AS occurred_at,
    event.updated_at,
    raw.observed_at,
    event.severity,
    ST_Y(event.geometry)::double precision,
    ST_X(event.geometry)::double precision,
    event.evidence_classification,
    event.parser_version,
    jsonb_build_object(
      'countryCode', event.country_code,
      'score', event.score,
      'datasource', event.datasource,
      'observedAt', event.observed_at,
      'endedAt', event.ended_at
    ),
    event.metadata,
    event.raw_observation_id::text,
    raw.collection_run_id::text,
    raw.archive_path,
    raw.content_hash
  FROM internet_outage_observations AS event
  INNER JOIN raw_observations AS raw
    ON raw.id = event.raw_observation_id
   AND raw.source_id = event.source_id

  UNION ALL

  SELECT
    event.id::text,
    'aviation'::text,
    'aircraft_position',
    event.source_id,
    event.source_aircraft_id,
    COALESCE(NULLIF(TRIM(event.callsign), ''), event.registration, event.icao24),
    event.aircraft_type,
    event.observed_at AS occurred_at,
    event.updated_at,
    raw.observed_at,
    CASE
      WHEN event.military_flag THEN 'medium'
      ELSE 'low'
    END,
    ST_Y(event.geometry)::double precision,
    ST_X(event.geometry)::double precision,
    event.evidence_classification,
    event.parser_version,
    jsonb_build_object(
      'icao24', event.icao24,
      'callsign', event.callsign,
      'registration', event.registration,
      'aircraftType', event.aircraft_type,
      'altitudeMeters', event.altitude_meters,
      'speedKnots', event.speed_knots,
      'heading', event.heading,
      'squawk', event.squawk,
      'nacP', event.nac_p,
      'militaryFlag', event.military_flag
    ),
    event.metadata,
    event.raw_observation_id::text,
    raw.collection_run_id::text,
    raw.archive_path,
    raw.content_hash
  FROM aircraft_position_observations AS event
  INNER JOIN raw_observations AS raw
    ON raw.id = event.raw_observation_id
   AND raw.source_id = event.source_id
)
SELECT
  event_rows.*,
  source.name AS source_name,
  source.provider
FROM event_rows
INNER JOIN source_catalogue AS source
  ON source.source_id = event_rows.source_id`;

const SOURCES_SQL = `
SELECT
  source.source_id,
  source.name,
  source.provider,
  source.description,
  source.access_method,
  source.cost_class,
  source.licence,
  source.terms_url,
  source.documentation_url,
  source.status,
  source.metadata,
  latest.id::text AS latest_run_id,
  latest.status AS latest_run_status,
  latest.started_at AS latest_run_started_at,
  latest.completed_at AS latest_run_completed_at,
  latest.response_received_at AS latest_run_response_received_at,
  latest.upstream_timestamp AS latest_run_upstream_timestamp,
  latest.record_count AS latest_run_record_count,
  latest.archive_path AS latest_run_archive_path,
  latest.error AS latest_run_error,
  COALESCE(totals.runs, 0)::integer AS total_runs,
  COALESCE(totals.successes, 0)::integer AS total_successes,
  COALESCE(totals.failures, 0)::integer AS total_failures,
  COALESCE(raw_counts.raw_observations, 0)::integer AS raw_observations
FROM source_catalogue AS source
LEFT JOIN LATERAL (
  SELECT *
  FROM collection_runs AS run
  WHERE run.source_id = source.source_id
  ORDER BY run.started_at DESC, run.id DESC
  LIMIT 1
) AS latest ON TRUE
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) AS runs,
    COUNT(*) FILTER (WHERE status = 'succeeded') AS successes,
    COUNT(*) FILTER (WHERE status = 'failed') AS failures
  FROM collection_runs AS run
  WHERE run.source_id = source.source_id
) AS totals ON TRUE
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS raw_observations
  FROM raw_observations AS raw
  WHERE raw.source_id = source.source_id
) AS raw_counts ON TRUE
ORDER BY source.provider ASC, source.name ASC`;

const MARKET_QUOTES_SQL = `
SELECT
  quote.id::text,
  quote.source_id,
  source.name AS source_name,
  source.provider,
  quote.symbol,
  quote.display_name,
  quote.quote_type,
  quote.currency,
  quote.price,
  quote.change_percent,
  quote.up,
  quote.observed_at,
  quote.updated_at,
  quote.evidence_classification,
  quote.parser_version,
  quote.metadata,
  quote.raw_observation_id::text,
  raw.collection_run_id::text,
  raw.archive_path,
  raw.content_hash
FROM market_quote_observations AS quote
INNER JOIN source_catalogue AS source
  ON source.source_id = quote.source_id
INNER JOIN raw_observations AS raw
  ON raw.id = quote.raw_observation_id
 AND raw.source_id = quote.source_id`;

const RAW_OBSERVATION_SQL = `
SELECT
  raw.id::text,
  raw.source_id,
  raw.collection_run_id::text,
  raw.source_record_id,
  raw.observed_at,
  raw.occurred_at,
  raw.source_updated_at,
  raw.first_seen_at,
  raw.last_seen_at,
  raw.content_hash,
  raw.archive_path,
  raw.payload,
  raw.schema_version,
  raw.parser_version,
  raw.evidence_classification,
  raw.metadata
FROM raw_observations AS raw
WHERE raw.id = $1
LIMIT 1`;

const COLLECTION_RUN_SQL = `
SELECT
  run.id::text,
  run.source_id,
  run.started_at,
  run.request_started_at,
  run.response_received_at,
  run.completed_at,
  run.upstream_timestamp,
  run.retry_not_before,
  run.status,
  run.endpoint,
  run.http_status,
  run.content_type,
  run.content_hash,
  run.archive_path,
  run.response_headers,
  run.record_count,
  run.collector_version,
  run.parser_version,
  run.legacy_provenance_incomplete,
  run.error,
  run.metrics
FROM collection_runs AS run
WHERE run.id = $1
LIMIT 1`;

const COLLECTION_RUNS_FOR_SOURCE_SQL = `
SELECT
  run.id::text,
  run.source_id,
  run.started_at,
  run.request_started_at,
  run.response_received_at,
  run.completed_at,
  run.upstream_timestamp,
  run.retry_not_before,
  run.status,
  run.endpoint,
  run.http_status,
  run.content_type,
  run.content_hash,
  run.archive_path,
  run.response_headers,
  run.record_count,
  run.collector_version,
  run.parser_version,
  run.legacy_provenance_incomplete,
  run.error,
  run.metrics,
  (
    SELECT COUNT(*)::integer
    FROM raw_observations AS raw
    WHERE raw.collection_run_id = run.id
  ) AS raw_observation_count
FROM collection_runs AS run
WHERE run.source_id = $1
ORDER BY run.started_at DESC, run.id DESC
LIMIT $2 OFFSET $3`;

const COLLECTION_RUN_LIST_SQL = `
SELECT
  run.id::text,
  run.source_id,
  source.name AS source_name,
  source.provider,
  run.started_at,
  run.request_started_at,
  run.response_received_at,
  run.completed_at,
  run.upstream_timestamp,
  run.retry_not_before,
  run.status,
  run.endpoint,
  run.http_status,
  run.content_type,
  run.content_hash,
  run.archive_path,
  run.response_headers,
  run.record_count,
  run.collector_version,
  run.parser_version,
  run.legacy_provenance_incomplete,
  run.error,
  run.metrics,
  (
    SELECT COUNT(*)::integer
    FROM raw_observations AS raw
    WHERE raw.collection_run_id = run.id
  ) AS raw_observation_count
FROM collection_runs AS run
INNER JOIN source_catalogue AS source
  ON source.source_id = run.source_id`;

const RAW_OBSERVATIONS_FOR_RUN_SQL = `
SELECT
  raw.id::text,
  raw.source_id,
  source.name AS source_name,
  source.provider,
  raw.collection_run_id::text,
  raw.source_record_id,
  raw.observed_at,
  raw.occurred_at,
  raw.source_updated_at,
  raw.first_seen_at,
  raw.last_seen_at,
  raw.content_hash,
  raw.archive_path,
  raw.schema_version,
  raw.parser_version,
  raw.evidence_classification,
  raw.metadata
FROM raw_observations AS raw
INNER JOIN source_catalogue AS source
  ON source.source_id = raw.source_id
WHERE raw.collection_run_id = $1
ORDER BY raw.observed_at DESC, raw.id DESC
LIMIT $2 OFFSET $3`;

const OPERATIONS_TOTALS_SQL = `
SELECT
  (SELECT COUNT(*)::integer FROM source_catalogue) AS sources,
  (SELECT COUNT(*)::integer FROM source_catalogue WHERE status = 'active') AS active_sources,
  COUNT(run.id)::integer AS runs,
  COUNT(run.id) FILTER (WHERE run.status = 'succeeded')::integer AS successful_runs,
  COUNT(run.id) FILTER (WHERE run.status = 'failed')::integer AS failed_runs,
  (SELECT COUNT(*)::integer FROM raw_observations) AS raw_observations,
  MAX(run.started_at) AS latest_run_started_at,
  MAX(run.completed_at) AS latest_run_completed_at
FROM collection_runs AS run`;

const OPERATIONS_RECENT_TOTALS_SQL = `
SELECT
  (SELECT COUNT(*)::integer FROM source_catalogue) AS sources,
  (SELECT COUNT(*)::integer FROM source_catalogue WHERE status = 'active') AS active_sources,
  COUNT(run.id)::integer AS runs,
  COUNT(run.id) FILTER (WHERE run.status = 'succeeded')::integer AS successful_runs,
  COUNT(run.id) FILTER (WHERE run.status = 'failed')::integer AS failed_runs,
  (
    SELECT COUNT(*)::integer
    FROM raw_observations AS raw
    WHERE raw.observed_at >= $1
  ) AS raw_observations,
  MAX(run.started_at) AS latest_run_started_at,
  MAX(run.completed_at) AS latest_run_completed_at
FROM collection_runs AS run
WHERE run.started_at >= $1`;

const OPERATIONS_STATUS_BREAKDOWN_SQL = `
SELECT
  COALESCE(run.status, 'unknown') AS status,
  COUNT(*)::integer AS count
FROM collection_runs AS run
GROUP BY COALESCE(run.status, 'unknown')
ORDER BY count DESC, status ASC`;

const OPERATIONS_SOURCE_HEALTH_SQL = `
SELECT
  source.source_id,
  source.name,
  source.provider,
  source.status,
  latest.id::text AS latest_run_id,
  latest.status AS latest_run_status,
  latest.started_at AS latest_run_started_at,
  latest.completed_at AS latest_run_completed_at,
  latest.error AS latest_run_error,
  COALESCE(totals.runs, 0)::integer AS runs,
  COALESCE(totals.successful_runs, 0)::integer AS successful_runs,
  COALESCE(totals.failed_runs, 0)::integer AS failed_runs,
  COALESCE(raw_counts.raw_observations, 0)::integer AS raw_observations
FROM source_catalogue AS source
LEFT JOIN LATERAL (
  SELECT *
  FROM collection_runs AS run
  WHERE run.source_id = source.source_id
  ORDER BY run.started_at DESC, run.id DESC
  LIMIT 1
) AS latest ON TRUE
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) AS runs,
    COUNT(*) FILTER (WHERE status = 'succeeded') AS successful_runs,
    COUNT(*) FILTER (WHERE status = 'failed') AS failed_runs
  FROM collection_runs AS run
  WHERE run.source_id = source.source_id
) AS totals ON TRUE
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS raw_observations
  FROM raw_observations AS raw
  WHERE raw.source_id = source.source_id
) AS raw_counts ON TRUE
ORDER BY
  CASE WHEN latest.status = 'failed' THEN 0 ELSE 1 END,
  latest.started_at DESC NULLS LAST,
  source.provider ASC,
  source.name ASC`;

const OPERATIONS_ALERTS_SQL = `
SELECT
  source.source_id,
  source.name,
  source.provider,
  source.status,
  latest.id::text AS latest_run_id,
  latest.status AS latest_run_status,
  latest.started_at AS latest_run_started_at,
  latest.completed_at AS latest_run_completed_at,
  latest.error AS latest_run_error,
  COALESCE(totals.runs, 0)::integer AS runs,
  COALESCE(totals.successful_runs, 0)::integer AS successful_runs,
  COALESCE(totals.failed_runs, 0)::integer AS failed_runs,
  COALESCE(recent.runs, 0)::integer AS recent_runs,
  COALESCE(recent.failed_runs, 0)::integer AS recent_failed_runs,
  COALESCE(recent_raw.raw_observations, 0)::integer AS recent_raw_observations
FROM source_catalogue AS source
LEFT JOIN LATERAL (
  SELECT *
  FROM collection_runs AS run
  WHERE run.source_id = source.source_id
  ORDER BY run.started_at DESC, run.id DESC
  LIMIT 1
) AS latest ON TRUE
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) AS runs,
    COUNT(*) FILTER (WHERE status = 'succeeded') AS successful_runs,
    COUNT(*) FILTER (WHERE status = 'failed') AS failed_runs
  FROM collection_runs AS run
  WHERE run.source_id = source.source_id
) AS totals ON TRUE
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) AS runs,
    COUNT(*) FILTER (WHERE status = 'failed') AS failed_runs
  FROM collection_runs AS run
  WHERE run.source_id = source.source_id
    AND run.started_at >= $1
) AS recent ON TRUE
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS raw_observations
  FROM raw_observations AS raw
  WHERE raw.source_id = source.source_id
    AND raw.observed_at >= $1
) AS recent_raw ON TRUE
ORDER BY
  CASE WHEN latest.status = 'failed' THEN 0 ELSE 1 END,
  latest.started_at ASC NULLS FIRST,
  source.provider ASC,
  source.name ASC`;

const DIAGNOSTICS_FAILING_SOURCES_SQL = `
SELECT
  source.source_id,
  source.name,
  source.provider,
  source.status,
  latest_failed.id::text AS latest_failed_run_id,
  latest_failed.started_at AS latest_failure_at,
  latest_failed.http_status AS latest_http_status,
  latest_failed.endpoint,
  latest_failed.archive_path,
  latest_failed.error,
  latest.status AS latest_run_status,
  latest.started_at AS latest_run_started_at,
  COALESCE(recent.runs, 0)::integer AS recent_runs,
  COALESCE(recent.failed_runs, 0)::integer AS recent_failed_runs
FROM source_catalogue AS source
JOIN LATERAL (
  SELECT run.id, run.started_at, run.http_status, run.endpoint, run.archive_path, run.error
  FROM collection_runs AS run
  WHERE run.source_id = source.source_id
    AND run.status = 'failed'
    AND run.started_at >= $1
  ORDER BY run.started_at DESC, run.id DESC
  LIMIT 1
) AS latest_failed ON TRUE
LEFT JOIN LATERAL (
  SELECT run.status, run.started_at
  FROM collection_runs AS run
  WHERE run.source_id = source.source_id
  ORDER BY run.started_at DESC, run.id DESC
  LIMIT 1
) AS latest ON TRUE
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) AS runs,
    COUNT(*) FILTER (WHERE status = 'failed') AS failed_runs
  FROM collection_runs AS run
  WHERE run.source_id = source.source_id
    AND run.started_at >= $1
) AS recent ON TRUE
ORDER BY latest_failed.started_at DESC, source.source_id ASC`;

const DIAGNOSTICS_RECENT_FAILURES_SQL = `
SELECT
  run.id::text AS run_id,
  run.source_id,
  source.name AS source_name,
  source.provider,
  run.started_at,
  run.completed_at,
  run.http_status,
  run.endpoint,
  run.archive_path,
  run.record_count,
  run.error
FROM collection_runs AS run
JOIN source_catalogue AS source ON source.source_id = run.source_id
WHERE run.status = 'failed'
  AND run.started_at >= $1
ORDER BY run.started_at DESC, run.id DESC
LIMIT $2`;

const ALERTS_SQL = `
SELECT
  alert.id::text,
  alert.alert_key,
  alert.kind,
  alert.severity,
  alert.status,
  alert.source_id,
  source.name AS source_name,
  source.provider,
  alert.entity_type,
  alert.entity_id,
  alert.title,
  alert.detail,
  alert.detected_at,
  alert.window_start,
  alert.window_end,
  alert.evidence_classification,
  alert.method,
  alert.calculation_version,
  alert.thresholds,
  alert.input_window,
  alert.evidence,
  alert.explanation,
  alert.explanation_status,
  alert.metadata,
  alert.raw_observation_id::text,
  raw.collection_run_id::text,
  raw.archive_path,
  raw.content_hash
FROM intelligence_alerts AS alert
INNER JOIN source_catalogue AS source
  ON source.source_id = alert.source_id
LEFT JOIN raw_observations AS raw
  ON raw.id = alert.raw_observation_id
 AND raw.source_id = alert.source_id`;

const MARKET_ALERT_INPUT_SQL = `
WITH price_points AS (
  SELECT
    history.id::text,
    history.source_id,
    source.name AS source_name,
    source.provider,
    'crypto_asset'::text AS entity_type,
    history.asset_id AS entity_id,
    history.symbol AS display_name,
    history.observed_at,
    history.price,
    history.currency,
    history.raw_observation_id::text,
    raw.collection_run_id::text,
    raw.archive_path,
    raw.content_hash
  FROM crypto_price_history AS history
  INNER JOIN source_catalogue AS source
    ON source.source_id = history.source_id
  INNER JOIN raw_observations AS raw
    ON raw.id = history.raw_observation_id
   AND raw.source_id = history.source_id
  WHERE history.observed_at >= $1

  UNION ALL

  SELECT
    history.id::text,
    history.source_id,
    source.name AS source_name,
    source.provider,
    'market_symbol'::text,
    history.symbol,
    history.display_name,
    history.observed_at,
    history.price,
    history.currency,
    history.raw_observation_id::text,
    raw.collection_run_id::text,
    raw.archive_path,
    raw.content_hash
  FROM market_quote_history AS history
  INNER JOIN source_catalogue AS source
    ON source.source_id = history.source_id
  INNER JOIN raw_observations AS raw
    ON raw.id = history.raw_observation_id
   AND raw.source_id = history.source_id
  WHERE history.observed_at >= $1
)
SELECT *
FROM price_points
ORDER BY source_id ASC, entity_type ASC, entity_id ASC, observed_at ASC, id ASC`;

const UPSERT_INTELLIGENCE_ALERT_SQL = `
WITH upsert AS (
  INSERT INTO intelligence_alerts AS current (
    id,
    alert_key,
    kind,
    severity,
    status,
    source_id,
    entity_type,
    entity_id,
    title,
    detail,
    detected_at,
    window_start,
    window_end,
    evidence_classification,
    method,
    calculation_version,
    thresholds,
    input_window,
    evidence,
    explanation,
    explanation_status,
    raw_observation_id,
    metadata
  ) VALUES (
    $1, $2, $3, $4, 'active', $5, $6, $7, $8, $9,
    $10, $11, $12, 'derived', $13, $14, $15::jsonb, $16::jsonb,
    $17::jsonb, $18, $19, $20, $21::jsonb
  )
  ON CONFLICT (alert_key)
  DO UPDATE SET
    severity = EXCLUDED.severity,
    status = EXCLUDED.status,
    title = EXCLUDED.title,
    detail = EXCLUDED.detail,
    detected_at = EXCLUDED.detected_at,
    window_start = EXCLUDED.window_start,
    window_end = EXCLUDED.window_end,
    evidence_classification = EXCLUDED.evidence_classification,
    method = EXCLUDED.method,
    calculation_version = EXCLUDED.calculation_version,
    thresholds = EXCLUDED.thresholds,
    input_window = EXCLUDED.input_window,
    evidence = EXCLUDED.evidence,
    explanation = EXCLUDED.explanation,
    explanation_status = EXCLUDED.explanation_status,
    raw_observation_id = EXCLUDED.raw_observation_id,
    metadata = EXCLUDED.metadata,
    updated_at = NOW()
  RETURNING current.*
)
SELECT
  upsert.id::text,
  upsert.alert_key,
  upsert.kind,
  upsert.severity,
  upsert.status,
  upsert.source_id,
  source.name AS source_name,
  source.provider,
  upsert.entity_type,
  upsert.entity_id,
  upsert.title,
  upsert.detail,
  upsert.detected_at,
  upsert.window_start,
  upsert.window_end,
  upsert.evidence_classification,
  upsert.method,
  upsert.calculation_version,
  upsert.thresholds,
  upsert.input_window,
  upsert.evidence,
  upsert.explanation,
  upsert.explanation_status,
  upsert.metadata,
  upsert.raw_observation_id::text,
  raw.collection_run_id::text,
  raw.archive_path,
  raw.content_hash
FROM upsert
INNER JOIN source_catalogue AS source
  ON source.source_id = upsert.source_id
LEFT JOIN raw_observations AS raw
  ON raw.id = upsert.raw_observation_id
 AND raw.source_id = upsert.source_id`;

const RESOLVE_STALE_MARKET_ALERTS_SQL = `
WITH resolved AS (
  UPDATE intelligence_alerts AS current
  SET
    status = 'resolved',
    metadata = current.metadata || jsonb_build_object(
      'resolvedAt', $1::timestamptz,
      'resolutionReason', 'not_present_in_current_market_anomaly_refresh',
      'resolutionCalculationVersion', $2::text
    ),
    updated_at = NOW()
  WHERE current.kind = 'market_price_movement'
    AND current.status = 'active'
    AND current.calculation_version = $2
    AND current.alert_key = ANY($3::text[])
    AND NOT (current.alert_key = ANY($4::text[]))
  RETURNING current.*
)
SELECT
  resolved.id::text,
  resolved.alert_key,
  resolved.kind,
  resolved.severity,
  resolved.status,
  resolved.source_id,
  source.name AS source_name,
  source.provider,
  resolved.entity_type,
  resolved.entity_id,
  resolved.title,
  resolved.detail,
  resolved.detected_at,
  resolved.window_start,
  resolved.window_end,
  resolved.evidence_classification,
  resolved.method,
  resolved.calculation_version,
  resolved.thresholds,
  resolved.input_window,
  resolved.evidence,
  resolved.explanation,
  resolved.explanation_status,
  resolved.metadata,
  resolved.raw_observation_id::text,
  raw.collection_run_id::text,
  raw.archive_path,
  raw.content_hash
FROM resolved
INNER JOIN source_catalogue AS source
  ON source.source_id = resolved.source_id
LEFT JOIN raw_observations AS raw
  ON raw.id = resolved.raw_observation_id
 AND raw.source_id = resolved.source_id`;

const EVIDENCE_EDGES_SQL = `
SELECT
  edge.id::text,
  edge.edge_key,
  edge.relation_type,
  edge.source_id,
  source.name AS source_name,
  source.provider,
  edge.effective_from,
  edge.effective_to,
  edge.confidence,
  edge.evidence_classification,
  edge.derivation_method,
  edge.validation_date::text,
  edge.metadata,
  edge.raw_observation_id::text,
  raw.collection_run_id::text,
  raw.archive_path,
  raw.content_hash,
  from_node.id::text AS from_node_id,
  from_node.node_key AS from_node_key,
  from_node.node_type AS from_node_type,
  from_node.source_id AS from_source_id,
  from_node.external_id AS from_external_id,
  from_node.label AS from_label,
  from_node.evidence_classification AS from_evidence_classification,
  from_node.metadata AS from_metadata,
  to_node.id::text AS to_node_id,
  to_node.node_key AS to_node_key,
  to_node.node_type AS to_node_type,
  to_node.source_id AS to_source_id,
  to_node.external_id AS to_external_id,
  to_node.label AS to_label,
  to_node.evidence_classification AS to_evidence_classification,
  to_node.metadata AS to_metadata
FROM evidence_edges AS edge
INNER JOIN evidence_nodes AS from_node
  ON from_node.id = edge.from_node_id
INNER JOIN evidence_nodes AS to_node
  ON to_node.id = edge.to_node_id
INNER JOIN source_catalogue AS source
  ON source.source_id = edge.source_id
LEFT JOIN raw_observations AS raw
  ON raw.id = edge.raw_observation_id
 AND raw.source_id = edge.raw_observation_source_id`;

const READINESS_SQL = `
WITH events AS (
${EVENT_UNION_SQL}
),
latest_run AS (
  SELECT
    run.id::text,
    run.status,
    run.started_at,
    run.completed_at
  FROM collection_runs AS run
  ORDER BY run.started_at DESC, run.id DESC
  LIMIT 1
)
SELECT
  (SELECT COUNT(*)::integer FROM schema_migrations) AS migrations_applied,
  (SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1) AS latest_migration,
  (SELECT MAX(applied_at) FROM schema_migrations) AS latest_migration_applied_at,
  (SELECT COUNT(*)::integer FROM source_catalogue) AS sources,
  (SELECT COUNT(*)::integer FROM source_catalogue WHERE status = 'active') AS active_sources,
  (SELECT COUNT(*)::integer FROM collection_runs) AS runs,
  (SELECT COUNT(*)::integer FROM collection_runs WHERE status = 'succeeded') AS successful_runs,
  (SELECT COUNT(*)::integer FROM collection_runs WHERE status = 'failed') AS failed_runs,
  (SELECT COUNT(*)::integer FROM collection_runs WHERE status = 'running') AS running_runs,
  (SELECT COUNT(*)::integer FROM raw_observations) AS raw_observations,
  (SELECT COUNT(*)::integer FROM raw_observations WHERE archive_path IS NOT NULL AND archive_path <> '') AS archived_raw_observations,
  (SELECT COUNT(*)::integer FROM events) AS events,
  latest_run.id AS latest_run_id,
  latest_run.status AS latest_run_status,
  latest_run.started_at AS latest_run_started_at,
  latest_run.completed_at AS latest_run_completed_at,
  (SELECT MAX(observed_at) FROM raw_observations) AS latest_raw_observed_at
FROM latest_run
RIGHT JOIN (SELECT 1) AS singleton ON TRUE`;

const COVERAGE_CATEGORY_SQL = `
WITH events AS (
${EVENT_UNION_SQL}
)
SELECT
  category,
  COUNT(*)::integer AS events,
  COUNT(DISTINCT source_id)::integer AS sources,
  MIN(occurred_at) AS earliest_occurred_at,
  MAX(occurred_at) AS latest_occurred_at,
  MAX(observed_at) AS latest_observed_at,
  MIN(latitude) AS south,
  MIN(longitude) AS west,
  MAX(latitude) AS north,
  MAX(longitude) AS east
FROM events`;

const COVERAGE_SOURCE_SQL = `
WITH events AS (
${EVENT_UNION_SQL}
),
event_by_source AS (
  SELECT
    source_id,
    COUNT(*)::integer AS events,
    MAX(occurred_at) AS latest_event_at
  FROM events`;

const COVERAGE_SOURCE_CATEGORY_SQL = `
),
category_by_source AS (
  SELECT
    source_id,
    jsonb_object_agg(category, event_count) AS category_counts
  FROM (
    SELECT
      source_id,
      category,
      COUNT(*)::integer AS event_count
    FROM events`;

const COVERAGE_SOURCE_TAIL_SQL = `
  ) AS counted
  GROUP BY source_id
),
quote_by_source AS (
  SELECT
    source_id,
    COUNT(*)::integer AS quotes,
    MAX(observed_at) AS latest_quote_at
  FROM market_quote_observations AS quote`;

const COVERAGE_SOURCE_RAW_SQL = `
),
raw_by_source AS (
  SELECT
    source_id,
    COUNT(*)::integer AS raw_observations,
    MAX(observed_at) AS latest_raw_observed_at
  FROM raw_observations AS raw`;

const COVERAGE_SOURCE_SELECT_SQL = `
)
SELECT
  source.source_id,
  source.name,
  source.provider,
  COALESCE(events.events, 0)::integer AS events,
  COALESCE(quotes.quotes, 0)::integer AS quotes,
  COALESCE(raw.raw_observations, 0)::integer AS raw_observations,
  events.latest_event_at,
  quotes.latest_quote_at,
  raw.latest_raw_observed_at,
  COALESCE(categories.category_counts, '{}'::jsonb) AS category_counts
FROM source_catalogue AS source
LEFT JOIN event_by_source AS events
  ON events.source_id = source.source_id
LEFT JOIN category_by_source AS categories
  ON categories.source_id = source.source_id
LEFT JOIN quote_by_source AS quotes
  ON quotes.source_id = source.source_id
LEFT JOIN raw_by_source AS raw
  ON raw.source_id = source.source_id
WHERE COALESCE(events.events, 0) > 0
   OR COALESCE(quotes.quotes, 0) > 0
   OR COALESCE(raw.raw_observations, 0) > 0
ORDER BY (COALESCE(events.events, 0) + COALESCE(quotes.quotes, 0) + COALESCE(raw.raw_observations, 0)) DESC,
  source.provider ASC,
  source.name ASC`;

const COVERAGE_TIMELINE_SQL = `
WITH events AS (
${EVENT_UNION_SQL}
),
event_buckets AS (
  SELECT
    date_trunc('day', occurred_at) AS bucket_start,
    COUNT(*)::integer AS events
  FROM events`;

const COVERAGE_TIMELINE_RAW_SQL = `
),
raw_buckets AS (
  SELECT
    date_trunc('day', observed_at) AS bucket_start,
    COUNT(*)::integer AS raw_observations
  FROM raw_observations AS raw`;

const COVERAGE_TIMELINE_RUN_SQL = `
),
run_buckets AS (
  SELECT
    date_trunc('day', started_at) AS bucket_start,
    COUNT(*)::integer AS runs
  FROM collection_runs AS run`;

const COVERAGE_TIMELINE_SELECT_SQL = `
),
combined AS (
  SELECT bucket_start, events, 0::integer AS raw_observations, 0::integer AS runs FROM event_buckets
  UNION ALL
  SELECT bucket_start, 0::integer, raw_observations, 0::integer FROM raw_buckets
  UNION ALL
  SELECT bucket_start, 0::integer, 0::integer, runs FROM run_buckets
)
SELECT
  bucket_start,
  SUM(events)::integer AS events,
  SUM(raw_observations)::integer AS raw_observations,
  SUM(runs)::integer AS runs
FROM combined
GROUP BY bucket_start
ORDER BY bucket_start ASC
LIMIT 60`;

interface EventRow extends QueryResultRow {
  id: string;
  category: string;
  event_type: string;
  source_id: string;
  source_name: string;
  provider: string;
  source_record_id: string;
  title: string;
  description: string | null;
  occurred_at: Date | string;
  updated_at: Date | string | null;
  observed_at: Date | string | null;
  severity: string | null;
  latitude: number;
  longitude: number;
  evidence_classification: string;
  parser_version: string;
  facts: Record<string, unknown>;
  metadata: Record<string, unknown>;
  raw_observation_id: string;
  collection_run_id: string | null;
  archive_path: string | null;
  content_hash: string | null;
}

interface SourceRow extends QueryResultRow {
  source_id: string;
  name: string;
  provider: string;
  description: string | null;
  access_method: string;
  cost_class: string;
  licence: string | null;
  terms_url: string | null;
  documentation_url: string | null;
  status: string;
  metadata: Record<string, unknown>;
  latest_run_id: string | null;
  latest_run_status: string | null;
  latest_run_started_at: Date | string | null;
  latest_run_completed_at: Date | string | null;
  latest_run_response_received_at: Date | string | null;
  latest_run_upstream_timestamp: Date | string | null;
  latest_run_record_count: number | null;
  latest_run_archive_path: string | null;
  latest_run_error: Record<string, unknown> | null;
  total_runs: number;
  total_successes: number;
  total_failures: number;
  raw_observations: number;
}

interface MarketQuoteRow extends QueryResultRow {
  id: string;
  source_id: string;
  source_name: string;
  provider: string;
  symbol: string;
  display_name: string;
  quote_type: string;
  currency: string | null;
  price: number;
  change_percent: number;
  up: boolean;
  observed_at: Date | string;
  updated_at: Date | string;
  evidence_classification: string;
  parser_version: string;
  metadata: Record<string, unknown>;
  raw_observation_id: string;
  collection_run_id: string | null;
  archive_path: string | null;
  content_hash: string | null;
}

interface RawObservationRow extends QueryResultRow {
  id: string;
  source_id: string;
  collection_run_id: string;
  source_record_id: string | null;
  observed_at: Date | string;
  occurred_at: Date | string | null;
  source_updated_at: Date | string | null;
  first_seen_at: Date | string;
  last_seen_at: Date | string;
  content_hash: string;
  archive_path: string;
  payload: unknown;
  schema_version: number;
  parser_version: string;
  evidence_classification: string;
  metadata: Record<string, unknown>;
}

interface RawObservationSummaryRow extends QueryResultRow {
  id: string;
  source_id: string;
  source_name: string;
  provider: string;
  collection_run_id: string;
  source_record_id: string | null;
  observed_at: Date | string;
  occurred_at: Date | string | null;
  source_updated_at: Date | string | null;
  first_seen_at: Date | string;
  last_seen_at: Date | string;
  content_hash: string;
  archive_path: string;
  schema_version: number;
  parser_version: string;
  evidence_classification: string;
  metadata: Record<string, unknown>;
}

interface CollectionRunRow extends QueryResultRow {
  id: string;
  source_id: string;
  started_at: Date | string;
  request_started_at: Date | string | null;
  response_received_at: Date | string | null;
  completed_at: Date | string | null;
  upstream_timestamp: Date | string | null;
  retry_not_before: Date | string | null;
  status: string;
  endpoint: string;
  http_status: number | null;
  content_type: string | null;
  content_hash: string | null;
  archive_path: string | null;
  response_headers: Record<string, unknown>;
  record_count: number | null;
  collector_version: string;
  parser_version: string | null;
  legacy_provenance_incomplete: boolean;
  error: Record<string, unknown> | null;
  metrics: Record<string, unknown>;
}

interface RawObservationCountRow extends QueryResultRow {
  raw_observation_count: number;
}

interface CollectionRunListRow extends CollectionRunRow {
  raw_observation_count: number;
}

interface CollectionRunSummaryRow extends CollectionRunListRow {
  source_name: string;
  provider: string;
}

interface OperationsTotalsRow extends QueryResultRow {
  sources: number;
  active_sources: number;
  runs: number;
  successful_runs: number;
  failed_runs: number;
  raw_observations: number;
  latest_run_started_at: Date | string | null;
  latest_run_completed_at: Date | string | null;
}

interface OperationsStatusRow extends QueryResultRow {
  status: string;
  count: number;
}

interface OperationsSourceHealthRow extends QueryResultRow {
  source_id: string;
  name: string;
  provider: string;
  status: string;
  latest_run_id: string | null;
  latest_run_status: string | null;
  latest_run_started_at: Date | string | null;
  latest_run_completed_at: Date | string | null;
  latest_run_error: Record<string, unknown> | null;
  runs: number;
  successful_runs: number;
  failed_runs: number;
  raw_observations: number;
}

interface OperationsAlertRow extends QueryResultRow {
  source_id: string;
  name: string;
  provider: string;
  status: string;
  latest_run_id: string | null;
  latest_run_status: string | null;
  latest_run_started_at: Date | string | null;
  latest_run_completed_at: Date | string | null;
  latest_run_error: Record<string, unknown> | null;
  runs: number;
  successful_runs: number;
  failed_runs: number;
  recent_runs: number;
  recent_failed_runs: number;
  recent_raw_observations: number;
}

interface CoverageCategoryRow extends QueryResultRow {
  category: string;
  events: number;
  sources: number;
  earliest_occurred_at: Date | string | null;
  latest_occurred_at: Date | string | null;
  latest_observed_at: Date | string | null;
  south: number | null;
  west: number | null;
  north: number | null;
  east: number | null;
}

interface CoverageSourceRow extends QueryResultRow {
  source_id: string;
  name: string;
  provider: string;
  events: number;
  quotes: number;
  raw_observations: number;
  latest_event_at: Date | string | null;
  latest_quote_at: Date | string | null;
  latest_raw_observed_at: Date | string | null;
  category_counts: Record<string, unknown>;
}

interface CoverageTimelineRow extends QueryResultRow {
  bucket_start: Date | string;
  events: number;
  raw_observations: number;
  runs: number;
}

interface ReadinessRow extends QueryResultRow {
  migrations_applied: number;
  latest_migration: string | null;
  latest_migration_applied_at: Date | string | null;
  sources: number;
  active_sources: number;
  runs: number;
  successful_runs: number;
  failed_runs: number;
  running_runs: number;
  raw_observations: number;
  archived_raw_observations: number;
  events: number;
  latest_run_id: string | null;
  latest_run_status: string | null;
  latest_run_started_at: Date | string | null;
  latest_run_completed_at: Date | string | null;
  latest_raw_observed_at: Date | string | null;
}

interface DiagnosticsFailingSourceRow extends QueryResultRow {
  source_id: string;
  name: string;
  provider: string;
  status: string;
  latest_failed_run_id: string;
  latest_failure_at: Date | string | null;
  latest_http_status: number | null;
  endpoint: string;
  archive_path: string | null;
  error: Record<string, unknown> | null;
  latest_run_status: string | null;
  latest_run_started_at: Date | string | null;
  recent_runs: number;
  recent_failed_runs: number;
}

interface DiagnosticsFailureRunRow extends QueryResultRow {
  run_id: string;
  source_id: string;
  source_name: string;
  provider: string;
  started_at: Date | string;
  completed_at: Date | string | null;
  http_status: number | null;
  endpoint: string;
  archive_path: string | null;
  record_count: number | null;
  error: Record<string, unknown> | null;
}

interface IntelligenceAlertRow extends QueryResultRow {
  id: string;
  alert_key: string;
  kind: string;
  severity: string;
  status: string;
  source_id: string;
  source_name: string;
  provider: string;
  entity_type: string;
  entity_id: string;
  title: string;
  detail: string;
  detected_at: Date | string;
  window_start: Date | string;
  window_end: Date | string;
  evidence_classification: string;
  method: string;
  calculation_version: string;
  thresholds: Record<string, unknown>;
  input_window: Record<string, unknown>;
  evidence: Record<string, unknown>;
  explanation: string;
  explanation_status: string;
  metadata: Record<string, unknown>;
  raw_observation_id: string | null;
  collection_run_id: string | null;
  archive_path: string | null;
  content_hash: string | null;
}

interface EvidenceEdgeRow extends QueryResultRow {
  id: string;
  edge_key: string;
  relation_type: string;
  source_id: string;
  source_name: string;
  provider: string;
  effective_from: Date | string | null;
  effective_to: Date | string | null;
  confidence: number;
  evidence_classification: string;
  derivation_method: string;
  validation_date: string;
  metadata: Record<string, unknown>;
  raw_observation_id: string | null;
  collection_run_id: string | null;
  archive_path: string | null;
  content_hash: string | null;
  from_node_id: string;
  from_node_key: string;
  from_node_type: string;
  from_source_id: string | null;
  from_external_id: string | null;
  from_label: string;
  from_evidence_classification: string;
  from_metadata: Record<string, unknown>;
  to_node_id: string;
  to_node_key: string;
  to_node_type: string;
  to_source_id: string | null;
  to_external_id: string | null;
  to_label: string;
  to_evidence_classification: string;
  to_metadata: Record<string, unknown>;
}

interface MarketAlertInputRow extends QueryResultRow {
  id: string;
  source_id: string;
  source_name: string;
  provider: string;
  entity_type: string;
  entity_id: string;
  display_name: string;
  observed_at: Date | string;
  price: number;
  currency: string | null;
  raw_observation_id: string;
  collection_run_id: string | null;
  archive_path: string | null;
  content_hash: string | null;
}

interface MarketPriceAlertCandidate {
  alertKey: string;
  kind: 'market_price_movement';
  severity: WorldStateAlertSeverity;
  sourceId: string;
  sourceName: string;
  provider: string;
  entityType: 'crypto_asset' | 'market_symbol';
  entityId: string;
  title: string;
  detail: string;
  detectedAt: Date;
  windowStart: Date;
  windowEnd: Date;
  thresholds: Record<string, unknown>;
  inputWindow: Record<string, unknown>;
  evidence: Record<string, unknown>;
  explanation: string;
  explanationStatus: 'explained' | 'unexplained';
  rawObservationId: string;
  metadata: Record<string, unknown>;
}

interface MarketPriceAlertDetection {
  candidates: MarketPriceAlertCandidate[];
  evaluatedAlertKeys: string[];
}

export class WorldStateService {
  constructor(private readonly executor: WorldStateQueryExecutor) {}

  async getReadiness(now = new Date()): Promise<WorldStateReadinessResponse> {
    const result = await this.executor.query<ReadinessRow>(READINESS_SQL, []);
    const summary = mapReadinessSummaryRow(result.rows[0]);
    const checks = readinessChecks(summary);
    return {
      status: aggregateReadinessStatus(checks),
      checks,
      summary,
      generatedAt: now.toISOString(),
    };
  }

  async getOperationsSummary(
    query: WorldStateOperationsSummaryQuery = {},
    now = new Date(),
  ): Promise<WorldStateOperationsSummaryResponse> {
    const since = query.since ?? new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const [totalsResult, recentResult, statusResult, sourceHealthResult] = await Promise.all([
      this.executor.query<OperationsTotalsRow>(OPERATIONS_TOTALS_SQL, []),
      this.executor.query<OperationsTotalsRow>(OPERATIONS_RECENT_TOTALS_SQL, [since]),
      this.executor.query<OperationsStatusRow>(OPERATIONS_STATUS_BREAKDOWN_SQL, []),
      this.executor.query<OperationsSourceHealthRow>(OPERATIONS_SOURCE_HEALTH_SQL, []),
    ]);

    return {
      totals: mapOperationsTotalsRow(totalsResult.rows[0]),
      recent: {
        ...mapOperationsTotalsRow(recentResult.rows[0]),
        since: since.toISOString(),
      },
      statusBreakdown: statusResult.rows.map(mapOperationsStatusRow),
      sourceHealth: sourceHealthResult.rows.map(mapOperationsSourceHealthRow),
      generatedAt: now.toISOString(),
    };
  }

  async getOperationsAlerts(
    query: WorldStateOperationsAlertsQuery = {},
    now = new Date(),
  ): Promise<WorldStateOperationsAlertsResponse> {
    const since = query.since ?? new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const result = await this.executor.query<OperationsAlertRow>(OPERATIONS_ALERTS_SQL, [since]);
    const alerts = result.rows.flatMap((row) => mapOperationsAlertsRow(row, since));
    return {
      alerts: alerts.sort(compareOperationsAlerts),
      generatedAt: now.toISOString(),
      filters: { since: since.toISOString() },
    };
  }

  async listAlerts(
    query: WorldStateAlertsQuery = {},
    now = new Date(),
  ): Promise<WorldStateAlertsResponse> {
    const normalised = normaliseAlertsQuery(query);
    const values: unknown[] = [];
    const where: string[] = [];

    if (normalised.since !== null) {
      values.push(normalised.since);
      where.push(`alert.detected_at >= $${values.length}`);
    }
    if (normalised.statuses.length > 0) {
      values.push(normalised.statuses);
      where.push(`alert.status = ANY($${values.length}::text[])`);
    }
    if (normalised.severities.length > 0) {
      values.push(normalised.severities);
      where.push(`alert.severity = ANY($${values.length}::text[])`);
    }
    if (normalised.kinds.length > 0) {
      values.push(normalised.kinds);
      where.push(`alert.kind = ANY($${values.length}::text[])`);
    }

    values.push(normalised.limit + 1, normalised.offset);
    const sql = [
      ALERTS_SQL,
      where.length > 0 ? `WHERE ${where.join(' AND ')}` : '',
      `ORDER BY alert.detected_at DESC, alert.severity ASC, alert.alert_key ASC LIMIT $${values.length - 1} OFFSET $${values.length}`,
    ].filter(Boolean).join('\n');

    const result = await this.executor.query<IntelligenceAlertRow>(sql, values);
    const visible = result.rows.slice(0, normalised.limit);
    return {
      alerts: visible.map(mapIntelligenceAlertRow),
      page: {
        limit: normalised.limit,
        returned: visible.length,
        nextCursor: result.rows.length > normalised.limit ? String(normalised.offset + normalised.limit) : null,
      },
      generatedAt: now.toISOString(),
      filters: {
        since: normalised.since?.toISOString() ?? null,
        statuses: normalised.statuses,
        severities: normalised.severities,
        kinds: normalised.kinds,
      },
    };
  }

  async listEvidenceEdges(
    query: WorldStateEvidenceQuery = {},
    now = new Date(),
  ): Promise<WorldStateEvidenceResponse> {
    const normalised = normaliseEvidenceQuery(query);
    const values: unknown[] = [];
    const where: string[] = [];

    if (normalised.nodeKey !== null) {
      values.push(normalised.nodeKey);
      where.push(`(from_node.node_key = $${values.length} OR to_node.node_key = $${values.length})`);
    }
    if (normalised.fromNodeKey !== null) {
      values.push(normalised.fromNodeKey);
      where.push(`from_node.node_key = $${values.length}`);
    }
    if (normalised.toNodeKey !== null) {
      values.push(normalised.toNodeKey);
      where.push(`to_node.node_key = $${values.length}`);
    }
    if (normalised.relationTypes.length > 0) {
      values.push(normalised.relationTypes);
      where.push(`edge.relation_type = ANY($${values.length}::text[])`);
    }
    if (normalised.sourceIds.length > 0) {
      values.push(normalised.sourceIds);
      where.push(`edge.source_id = ANY($${values.length}::text[])`);
    }
    if (normalised.evidenceClassifications.length > 0) {
      values.push(normalised.evidenceClassifications);
      where.push(`edge.evidence_classification = ANY($${values.length}::text[])`);
    }

    values.push(normalised.limit + 1, normalised.offset);
    const sql = [
      EVIDENCE_EDGES_SQL,
      where.length > 0 ? `WHERE ${where.join(' AND ')}` : '',
      `ORDER BY edge.validation_date DESC, edge.edge_key ASC LIMIT $${values.length - 1} OFFSET $${values.length}`,
    ].filter(Boolean).join('\n');

    const result = await this.executor.query<EvidenceEdgeRow>(sql, values);
    const visible = result.rows.slice(0, normalised.limit);
    return {
      edges: visible.map(mapEvidenceEdgeRow),
      page: {
        limit: normalised.limit,
        returned: visible.length,
        nextCursor: result.rows.length > normalised.limit ? String(normalised.offset + normalised.limit) : null,
      },
      generatedAt: now.toISOString(),
      filters: {
        nodeKey: normalised.nodeKey,
        fromNodeKey: normalised.fromNodeKey,
        toNodeKey: normalised.toNodeKey,
        relationTypes: normalised.relationTypes,
        sourceIds: normalised.sourceIds,
        evidenceClassifications: normalised.evidenceClassifications,
      },
    };
  }

  async refreshMarketAnomalyAlerts(
    query: WorldStateRefreshAlertsQuery = {},
    now = new Date(),
  ): Promise<WorldStateRefreshAlertsResponse> {
    const normalised = normaliseRefreshAlertsQuery(query, now);
    const historyResult = await this.executor.query<MarketAlertInputRow>(
      MARKET_ALERT_INPUT_SQL,
      [normalised.since],
    );
    const detection = detectMarketPriceMovementAlerts(historyResult.rows, {
      minSamples: normalised.minSamples,
      thresholdPercent: normalised.thresholdPercent,
    });
    const alerts: WorldStateIntelligenceAlert[] = [];

    for (const candidate of detection.candidates) {
      const result = await this.executor.query<IntelligenceAlertRow>(
        UPSERT_INTELLIGENCE_ALERT_SQL,
        [
          randomUUID(),
          candidate.alertKey,
          candidate.kind,
          candidate.severity,
          candidate.sourceId,
          candidate.entityType,
          candidate.entityId,
          candidate.title,
          candidate.detail,
          candidate.detectedAt,
          candidate.windowStart,
          candidate.windowEnd,
          MARKET_ANOMALY_METHOD,
          MARKET_ANOMALY_CALCULATION_VERSION,
          JSON.stringify(candidate.thresholds),
          JSON.stringify(candidate.inputWindow),
          JSON.stringify(candidate.evidence),
          candidate.explanation,
          candidate.explanationStatus,
          candidate.rawObservationId,
          JSON.stringify(candidate.metadata),
        ],
      );
      const row = result.rows[0];
      if (row !== undefined) {
        alerts.push(mapIntelligenceAlertRow(row));
      }
    }

    const resolvedAlerts = detection.evaluatedAlertKeys.length === 0
      ? []
      : (await this.executor.query<IntelligenceAlertRow>(
        RESOLVE_STALE_MARKET_ALERTS_SQL,
        [
          now,
          MARKET_ANOMALY_CALCULATION_VERSION,
          detection.evaluatedAlertKeys,
          detection.candidates.map((candidate) => candidate.alertKey),
        ],
      )).rows.map(mapIntelligenceAlertRow);

    return {
      alertsCreatedOrUpdated: alerts.length,
      alertsResolved: resolvedAlerts.length,
      alerts,
      resolvedAlerts,
      generatedAt: now.toISOString(),
      calculationVersion: MARKET_ANOMALY_CALCULATION_VERSION,
      filters: {
        since: normalised.since.toISOString(),
        minSamples: normalised.minSamples,
        thresholdPercent: normalised.thresholdPercent,
      },
    };
  }

  async getCollectorDiagnostics(
    query: WorldStateCollectorDiagnosticsQuery = {},
    now = new Date(),
  ): Promise<WorldStateCollectorDiagnosticsResponse> {
    const since = query.since ?? new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const [failingResult, failureResult] = await Promise.all([
      this.executor.query<DiagnosticsFailingSourceRow>(DIAGNOSTICS_FAILING_SOURCES_SQL, [since]),
      this.executor.query<DiagnosticsFailureRunRow>(DIAGNOSTICS_RECENT_FAILURES_SQL, [since, limit]),
    ]);
    return {
      failingSources: failingResult.rows.map(mapDiagnosticsFailingSourceRow),
      recentFailures: failureResult.rows.map(mapDiagnosticsFailureRunRow),
      generatedAt: now.toISOString(),
      filters: { since: since.toISOString(), limit },
    };
  }

  async getCoverage(
    query: WorldStateCoverageQuery = {},
    now = new Date(),
  ): Promise<WorldStateCoverageResponse> {
    const normalised = normaliseCoverageQuery(query);
    const categoryValues: unknown[] = [];
    const categoryWhere = coverageWhere('occurred_at', categoryValues, normalised);
    const categoryResult = await this.executor.query<CoverageCategoryRow>(
      [
        COVERAGE_CATEGORY_SQL,
        categoryWhere ? `WHERE ${categoryWhere}` : '',
        'GROUP BY category',
        'ORDER BY events DESC, category ASC',
      ].filter(Boolean).join('\n'),
      categoryValues,
    );

    const sourceValues: unknown[] = [];
    const sourceEventWhere = coverageWhere('occurred_at', sourceValues, normalised);
    const sourceCategoryWhere = coverageWhere('occurred_at', sourceValues, normalised);
    const sourceQuoteWhere = coverageWhere('quote.observed_at', sourceValues, normalised);
    const sourceRawWhere = coverageWhere('raw.observed_at', sourceValues, normalised);
    const sourceResult = await this.executor.query<CoverageSourceRow>(
      [
        COVERAGE_SOURCE_SQL,
        sourceEventWhere ? `WHERE ${sourceEventWhere}` : '',
        'GROUP BY source_id',
        COVERAGE_SOURCE_CATEGORY_SQL,
        sourceCategoryWhere ? `WHERE ${sourceCategoryWhere}` : '',
        'GROUP BY source_id, category',
        COVERAGE_SOURCE_TAIL_SQL,
        sourceQuoteWhere ? `WHERE ${sourceQuoteWhere}` : '',
        'GROUP BY source_id',
        COVERAGE_SOURCE_RAW_SQL,
        sourceRawWhere ? `WHERE ${sourceRawWhere}` : '',
        'GROUP BY source_id',
        COVERAGE_SOURCE_SELECT_SQL,
      ].filter(Boolean).join('\n'),
      sourceValues,
    );

    const timelineValues: unknown[] = [];
    const timelineEventWhere = coverageWhere('occurred_at', timelineValues, normalised);
    const timelineRawWhere = coverageWhere('raw.observed_at', timelineValues, normalised);
    const timelineRunWhere = coverageWhere('run.started_at', timelineValues, normalised);
    const timelineResult = await this.executor.query<CoverageTimelineRow>(
      [
        COVERAGE_TIMELINE_SQL,
        timelineEventWhere ? `WHERE ${timelineEventWhere}` : '',
        'GROUP BY bucket_start',
        COVERAGE_TIMELINE_RAW_SQL,
        timelineRawWhere ? `WHERE ${timelineRawWhere}` : '',
        'GROUP BY bucket_start',
        COVERAGE_TIMELINE_RUN_SQL,
        timelineRunWhere ? `WHERE ${timelineRunWhere}` : '',
        'GROUP BY bucket_start',
        COVERAGE_TIMELINE_SELECT_SQL,
      ].filter(Boolean).join('\n'),
      timelineValues,
    );

    return {
      categories: categoryResult.rows.map(mapCoverageCategoryRow),
      sources: sourceResult.rows.map(mapCoverageSourceRow),
      timeline: timelineResult.rows.map(mapCoverageTimelineRow),
      generatedAt: now.toISOString(),
      filters: {
        since: normalised.since?.toISOString() ?? null,
        until: normalised.until?.toISOString() ?? null,
      },
    };
  }

  async listSources(now = new Date()): Promise<WorldStateSourcesResponse> {
    const result = await this.executor.query<SourceRow>(SOURCES_SQL, []);
    return {
      sources: result.rows.map(mapSourceRow),
      generatedAt: now.toISOString(),
    };
  }

  async getSourceById(sourceId: string, now = new Date()): Promise<WorldStateSourceDetailResponse> {
    const id = sourceId.trim();
    if (!isSourceId(id)) {
      return { source: null, recentEvents: [], recentQuotes: [], generatedAt: now.toISOString() };
    }

    const sourceResponse = await this.listSources(now);
    const source = sourceResponse.sources.find((candidate) => candidate.sourceId === id) ?? null;
    if (source === null) {
      return { source: null, recentEvents: [], recentQuotes: [], generatedAt: now.toISOString() };
    }

    const [events, quotes] = await Promise.all([
      this.listEvents({ sourceIds: [id], limit: 25 }, now),
      this.listMarketQuotes({ sourceIds: [id], limit: 25 }, now),
    ]);

    return {
      source,
      recentEvents: events.events,
      recentQuotes: quotes.quotes,
      generatedAt: now.toISOString(),
    };
  }

  async listCollectionRunsForSource(
    sourceId: string,
    query: WorldStateCollectionRunQuery = {},
    now = new Date(),
  ): Promise<WorldStateCollectionRunsResponse> {
    const id = sourceId.trim();
    const normalised = normaliseCollectionRunQuery(query);
    if (!isSourceId(id)) {
      return {
        runs: [],
        page: { limit: normalised.limit, returned: 0, nextCursor: null },
        generatedAt: now.toISOString(),
        filters: { sourceId: id },
      };
    }

    const result = await this.executor.query<CollectionRunListRow>(
      COLLECTION_RUNS_FOR_SOURCE_SQL,
      [id, normalised.limit + 1, normalised.offset],
    );
    const visible = result.rows.slice(0, normalised.limit);
    return {
      runs: visible.map(mapCollectionRunListRow),
      page: {
        limit: normalised.limit,
        returned: visible.length,
        nextCursor: result.rows.length > normalised.limit ? String(normalised.offset + normalised.limit) : null,
      },
      generatedAt: now.toISOString(),
      filters: { sourceId: id },
    };
  }

  async listCollectionRuns(
    query: WorldStateCollectionRunsQuery = {},
    now = new Date(),
  ): Promise<WorldStateCollectionRunListResponse> {
    const normalised = normaliseCollectionRunsQuery(query);
    const values: unknown[] = [];
    const where: string[] = [];

    if (normalised.sourceIds.length > 0) {
      values.push(normalised.sourceIds);
      where.push(`run.source_id = ANY($${values.length}::text[])`);
    }
    if (normalised.statuses.length > 0) {
      values.push(normalised.statuses);
      where.push(`run.status = ANY($${values.length}::text[])`);
    }
    if (normalised.since !== null) {
      values.push(normalised.since);
      where.push(`run.started_at >= $${values.length}`);
    }
    if (normalised.until !== null) {
      values.push(normalised.until);
      where.push(`run.started_at <= $${values.length}`);
    }

    values.push(normalised.limit + 1, normalised.offset);
    const sql = [
      COLLECTION_RUN_LIST_SQL,
      where.length > 0 ? `WHERE ${where.join(' AND ')}` : '',
      `ORDER BY run.started_at DESC, run.id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
    ].filter(Boolean).join('\n');

    const result = await this.executor.query<CollectionRunSummaryRow>(sql, values);
    const visible = result.rows.slice(0, normalised.limit);
    return {
      runs: visible.map(mapCollectionRunSummaryRow),
      page: {
        limit: normalised.limit,
        returned: visible.length,
        nextCursor: result.rows.length > normalised.limit ? String(normalised.offset + normalised.limit) : null,
      },
      generatedAt: now.toISOString(),
      filters: {
        sourceIds: normalised.sourceIds,
        statuses: normalised.statuses,
        since: normalised.since?.toISOString() ?? null,
        until: normalised.until?.toISOString() ?? null,
      },
    };
  }

  async listRawObservationsForRun(
    collectionRunId: string,
    query: WorldStateRunRawObservationQuery = {},
    now = new Date(),
  ): Promise<WorldStateRunRawObservationsResponse> {
    const runId = collectionRunId.trim();
    const normalised = normaliseRunRawObservationQuery(query);
    if (!isUuid(runId)) {
      return {
        rawObservations: [],
        page: { limit: normalised.limit, returned: 0, nextCursor: null },
        generatedAt: now.toISOString(),
        filters: { collectionRunId: runId },
      };
    }

    const result = await this.executor.query<RawObservationSummaryRow>(
      RAW_OBSERVATIONS_FOR_RUN_SQL,
      [runId, normalised.limit + 1, normalised.offset],
    );
    const visible = result.rows.slice(0, normalised.limit);
    return {
      rawObservations: visible.map(mapRawObservationSummaryRow),
      page: {
        limit: normalised.limit,
        returned: visible.length,
        nextCursor: result.rows.length > normalised.limit ? String(normalised.offset + normalised.limit) : null,
      },
      generatedAt: now.toISOString(),
      filters: { collectionRunId: runId },
    };
  }

  async listEvents(query: WorldStateEventQuery = {}, now = new Date()): Promise<WorldStateEventsResponse> {
    const normalised = normaliseEventQuery(query);
    const values: unknown[] = [];
    const where: string[] = [];

    if (normalised.categories.length !== DEFAULT_EVENT_CATEGORIES.length) {
      values.push(normalised.categories);
      where.push(`category = ANY($${values.length}::text[])`);
    }
    if (normalised.sourceIds.length > 0) {
      values.push(normalised.sourceIds);
      where.push(`source_id = ANY($${values.length}::text[])`);
    }
    if (normalised.since !== null) {
      values.push(normalised.since);
      where.push(`occurred_at >= $${values.length}`);
    }
    if (normalised.until !== null) {
      values.push(normalised.until);
      where.push(`occurred_at <= $${values.length}`);
    }
    if (normalised.bbox !== null) {
      const [west, south, east, north] = normalised.bbox;
      values.push(west, east, south, north);
      where.push(`longitude BETWEEN $${values.length - 3} AND $${values.length - 2}`);
      where.push(`latitude BETWEEN $${values.length - 1} AND $${values.length}`);
    }

    values.push(normalised.limit + 1, normalised.offset);
    const sql = [
      EVENT_UNION_SQL,
      where.length > 0 ? `WHERE ${where.join(' AND ')}` : '',
      `ORDER BY occurred_at DESC, id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
    ].filter(Boolean).join('\n');

    const result = await this.executor.query<EventRow>(sql, values);
    const visible = result.rows.slice(0, normalised.limit);
    return {
      events: visible.map(mapEventRow),
      page: {
        limit: normalised.limit,
        returned: visible.length,
        nextCursor: result.rows.length > normalised.limit ? String(normalised.offset + normalised.limit) : null,
      },
      generatedAt: now.toISOString(),
      filters: {
        categories: normalised.categories,
        sourceIds: normalised.sourceIds,
        since: normalised.since?.toISOString() ?? null,
        until: normalised.until?.toISOString() ?? null,
        bbox: normalised.bbox,
      },
    };
  }

  async getEventById(id: string, now = new Date()): Promise<WorldStateEventDetailResponse> {
    const eventId = id.trim();
    if (!/^[0-9a-fA-F-]{10,}$/.test(eventId)) {
      return { event: null, generatedAt: now.toISOString() };
    }

    const result = await this.executor.query<EventRow>(
      `${EVENT_UNION_SQL}\nWHERE id = $1\nORDER BY occurred_at DESC, id DESC\nLIMIT 1`,
      [eventId],
    );
    return {
      event: result.rows[0] ? mapEventRow(result.rows[0]) : null,
      generatedAt: now.toISOString(),
    };
  }

  async getRawObservationById(id: string, now = new Date()): Promise<WorldStateRawObservationResponse> {
    const rawId = id.trim();
    if (!isUuid(rawId)) {
      return { rawObservation: null, collectionRun: null, generatedAt: now.toISOString() };
    }

    const rawResult = await this.executor.query<RawObservationRow>(RAW_OBSERVATION_SQL, [rawId]);
    const rawObservation = rawResult.rows[0] ? mapRawObservationRow(rawResult.rows[0]) : null;
    if (rawObservation === null) {
      return { rawObservation: null, collectionRun: null, generatedAt: now.toISOString() };
    }

    const runResult = await this.executor.query<CollectionRunRow>(COLLECTION_RUN_SQL, [rawObservation.collectionRunId]);
    return {
      rawObservation,
      collectionRun: runResult.rows[0] ? mapCollectionRunRow(runResult.rows[0]) : null,
      generatedAt: now.toISOString(),
    };
  }

  async getCollectionRunById(id: string, now = new Date()): Promise<WorldStateCollectionRunResponse> {
    const runId = id.trim();
    if (!isUuid(runId)) {
      return { collectionRun: null, rawObservationCount: 0, generatedAt: now.toISOString() };
    }

    const [runResult, countResult] = await Promise.all([
      this.executor.query<CollectionRunRow>(COLLECTION_RUN_SQL, [runId]),
      this.executor.query<RawObservationCountRow>(
        'SELECT COUNT(*)::integer AS raw_observation_count FROM raw_observations WHERE collection_run_id = $1',
        [runId],
      ),
    ]);

    return {
      collectionRun: runResult.rows[0] ? mapCollectionRunRow(runResult.rows[0]) : null,
      rawObservationCount: countResult.rows[0]?.raw_observation_count ?? 0,
      generatedAt: now.toISOString(),
    };
  }

  async listMarketQuotes(query: WorldStateMarketQuoteQuery = {}, now = new Date()): Promise<WorldStateMarketQuotesResponse> {
    const normalised = normaliseMarketQuoteQuery(query);
    const values: unknown[] = [];
    const where: string[] = [];

    if (normalised.symbols.length > 0) {
      values.push(normalised.symbols);
      where.push(`quote.symbol = ANY($${values.length}::text[])`);
    }
    if (normalised.quoteTypes.length > 0) {
      values.push(normalised.quoteTypes);
      where.push(`quote.quote_type = ANY($${values.length}::text[])`);
    }
    if (normalised.sourceIds.length > 0) {
      values.push(normalised.sourceIds);
      where.push(`quote.source_id = ANY($${values.length}::text[])`);
    }
    if (normalised.since !== null) {
      values.push(normalised.since);
      where.push(`quote.observed_at >= $${values.length}`);
    }

    values.push(normalised.limit + 1, normalised.offset);
    const sql = [
      MARKET_QUOTES_SQL,
      where.length > 0 ? `WHERE ${where.join(' AND ')}` : '',
      `ORDER BY quote.observed_at DESC, quote.symbol ASC LIMIT $${values.length - 1} OFFSET $${values.length}`,
    ].filter(Boolean).join('\n');

    const result = await this.executor.query<MarketQuoteRow>(sql, values);
    const visible = result.rows.slice(0, normalised.limit);
    return {
      quotes: visible.map(mapMarketQuoteRow),
      page: {
        limit: normalised.limit,
        returned: visible.length,
        nextCursor: result.rows.length > normalised.limit ? String(normalised.offset + normalised.limit) : null,
      },
      generatedAt: now.toISOString(),
      filters: {
        symbols: normalised.symbols,
        quoteTypes: normalised.quoteTypes,
        sourceIds: normalised.sourceIds,
        since: normalised.since?.toISOString() ?? null,
      },
    };
  }
}

function normaliseEventQuery(query: WorldStateEventQuery) {
  const categories = (query.categories?.length ? query.categories : DEFAULT_EVENT_CATEGORIES)
    .filter((category): category is WorldStateEventCategory => EVENT_CATEGORIES.has(category));
  return {
    categories: uniqueValues(categories.length > 0 ? categories : DEFAULT_EVENT_CATEGORIES),
    sourceIds: uniqueStrings(query.sourceIds ?? []),
    since: query.since ?? null,
    until: query.until ?? null,
    bbox: query.bbox ?? null,
    limit: boundedLimit(query.limit),
    offset: parseCursor(query.cursor),
  };
}

function normaliseMarketQuoteQuery(query: WorldStateMarketQuoteQuery) {
  return {
    symbols: uniqueStrings(query.symbols ?? []).map((symbol) => symbol.toUpperCase()),
    quoteTypes: uniqueStrings(query.quoteTypes ?? []),
    sourceIds: uniqueStrings(query.sourceIds ?? []),
    since: query.since ?? null,
    limit: boundedLimit(query.limit),
    offset: parseCursor(query.cursor),
  };
}

function normaliseCollectionRunQuery(query: WorldStateCollectionRunQuery) {
  return {
    limit: boundedLimit(query.limit),
    offset: parseCursor(query.cursor),
  };
}

function normaliseCollectionRunsQuery(query: WorldStateCollectionRunsQuery) {
  return {
    sourceIds: uniqueStrings(query.sourceIds ?? []),
    statuses: uniqueStrings(query.statuses ?? []),
    since: query.since ?? null,
    until: query.until ?? null,
    limit: boundedLimit(query.limit),
    offset: parseCursor(query.cursor),
  };
}

function normaliseRunRawObservationQuery(query: WorldStateRunRawObservationQuery) {
  return {
    limit: boundedLimit(query.limit),
    offset: parseCursor(query.cursor),
  };
}

function normaliseCoverageQuery(query: WorldStateCoverageQuery) {
  return {
    since: query.since ?? null,
    until: query.until ?? null,
  };
}

function normaliseAlertsQuery(query: WorldStateAlertsQuery) {
  return {
    since: query.since ?? null,
    statuses: uniqueEnumValues(query.statuses ?? [], new Set<WorldStateAlertStatus>(['active', 'resolved'])),
    severities: uniqueEnumValues(query.severities ?? [], new Set<WorldStateAlertSeverity>(['critical', 'warning', 'info'])),
    kinds: uniqueEnumValues(query.kinds ?? [], new Set<WorldStateAlertKind>(['market_price_movement'])),
    limit: boundedLimit(query.limit),
    offset: parseCursor(query.cursor),
  };
}

function normaliseRefreshAlertsQuery(query: WorldStateRefreshAlertsQuery, now: Date) {
  const minSamples = Number.isInteger(query.minSamples)
    ? Math.max(3, Math.min(query.minSamples ?? 12, 100))
    : 12;
  const thresholdPercent = typeof query.thresholdPercent === 'number' && Number.isFinite(query.thresholdPercent)
    ? Math.max(1, Math.min(query.thresholdPercent, 100))
    : 5;
  return {
    since: query.since ?? new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
    minSamples,
    thresholdPercent,
  };
}

function normaliseEvidenceQuery(query: WorldStateEvidenceQuery) {
  return {
    nodeKey: cleanIdentifier(query.nodeKey),
    fromNodeKey: cleanIdentifier(query.fromNodeKey),
    toNodeKey: cleanIdentifier(query.toNodeKey),
    relationTypes: uniqueEnumValues(query.relationTypes ?? [], EVIDENCE_RELATION_TYPES),
    sourceIds: uniqueStrings(query.sourceIds ?? []),
    evidenceClassifications: uniqueEnumValues(query.evidenceClassifications ?? [], EVIDENCE_CLASSIFICATIONS),
    limit: boundedLimit(query.limit),
    offset: parseCursor(query.cursor),
  };
}

function coverageWhere(
  field: string,
  values: unknown[],
  query: { since: Date | null; until: Date | null },
): string {
  const where: string[] = [];
  if (query.since !== null) {
    values.push(query.since);
    where.push(`${field} >= $${values.length}`);
  }
  if (query.until !== null) {
    values.push(query.until);
    where.push(`${field} <= $${values.length}`);
  }
  return where.join(' AND ');
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function cleanIdentifier(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function uniqueValues<T extends string>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function uniqueEnumValues<T extends string>(values: string[], allowed: Set<T>): T[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter((value): value is T => allowed.has(value as T))));
}

function boundedLimit(value: number | undefined): number {
  if (value === undefined) return 100;
  if (!Number.isInteger(value)) return 100;
  return Math.max(1, Math.min(value, 500));
}

function parseCursor(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return 0;
  return Math.min(parsed, 100_000);
}

function isUuid(value: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value);
}

function isSourceId(value: string): boolean {
  return /^[A-Za-z0-9_.:-]{2,160}$/.test(value);
}

function mapSourceRow(row: SourceRow): WorldStateSourceSummary {
  return {
    sourceId: row.source_id,
    name: row.name,
    provider: row.provider,
    description: row.description,
    accessMethod: row.access_method,
    costClass: row.cost_class,
    licence: row.licence,
    termsUrl: row.terms_url,
    documentationUrl: row.documentation_url,
    status: row.status,
    metadata: objectValue(row.metadata),
    latestRun: {
      id: row.latest_run_id,
      status: row.latest_run_status,
      startedAt: timestamp(row.latest_run_started_at),
      completedAt: timestamp(row.latest_run_completed_at),
      responseReceivedAt: timestamp(row.latest_run_response_received_at),
      upstreamTimestamp: timestamp(row.latest_run_upstream_timestamp),
      recordCount: row.latest_run_record_count,
      archivePath: row.latest_run_archive_path,
      error: row.latest_run_error,
    },
    totals: {
      runs: row.total_runs,
      successes: row.total_successes,
      failures: row.total_failures,
      rawObservations: row.raw_observations,
    },
  };
}

function mapEventRow(row: EventRow): WorldStateEvent {
  return {
    id: row.id,
    category: row.category as WorldStateEventCategory,
    eventType: row.event_type,
    sourceId: row.source_id,
    sourceName: row.source_name,
    provider: row.provider,
    sourceRecordId: row.source_record_id,
    title: row.title,
    description: row.description,
    occurredAt: requiredTimestamp(row.occurred_at, 'occurred_at'),
    updatedAt: timestamp(row.updated_at),
    observedAt: timestamp(row.observed_at),
    severity: row.severity,
    point: {
      lat: finiteNumber(row.latitude, 'latitude'),
      lon: finiteNumber(row.longitude, 'longitude'),
    },
    evidenceClassification: row.evidence_classification as WorldStateEvent['evidenceClassification'],
    parserVersion: row.parser_version,
    facts: objectValue(row.facts),
    metadata: objectValue(row.metadata),
    raw: {
      rawObservationId: row.raw_observation_id,
      collectionRunId: row.collection_run_id,
      archivePath: row.archive_path,
      contentHash: row.content_hash,
    },
  };
}

function mapMarketQuoteRow(row: MarketQuoteRow): WorldStateMarketQuote {
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceName: row.source_name,
    provider: row.provider,
    symbol: row.symbol,
    displayName: row.display_name,
    quoteType: row.quote_type,
    currency: row.currency,
    price: finiteNumber(row.price, 'price'),
    changePercent: finiteNumber(row.change_percent, 'change_percent'),
    up: row.up,
    observedAt: requiredTimestamp(row.observed_at, 'observed_at'),
    updatedAt: requiredTimestamp(row.updated_at, 'updated_at'),
    evidenceClassification: row.evidence_classification as WorldStateMarketQuote['evidenceClassification'],
    parserVersion: row.parser_version,
    metadata: objectValue(row.metadata),
    raw: {
      rawObservationId: row.raw_observation_id,
      collectionRunId: row.collection_run_id,
      archivePath: row.archive_path,
      contentHash: row.content_hash,
    },
  };
}

function mapIntelligenceAlertRow(row: IntelligenceAlertRow): WorldStateIntelligenceAlert {
  return {
    id: row.id,
    alertKey: row.alert_key,
    kind: row.kind as WorldStateIntelligenceAlert['kind'],
    severity: row.severity as WorldStateIntelligenceAlert['severity'],
    status: row.status as WorldStateIntelligenceAlert['status'],
    sourceId: row.source_id,
    sourceName: row.source_name,
    provider: row.provider,
    entityType: row.entity_type as WorldStateIntelligenceAlert['entityType'],
    entityId: row.entity_id,
    title: row.title,
    detail: row.detail,
    detectedAt: requiredTimestamp(row.detected_at, 'detected_at'),
    windowStart: requiredTimestamp(row.window_start, 'window_start'),
    windowEnd: requiredTimestamp(row.window_end, 'window_end'),
    evidenceClassification: row.evidence_classification as WorldStateIntelligenceAlert['evidenceClassification'],
    method: row.method,
    calculationVersion: row.calculation_version,
    thresholds: objectValue(row.thresholds),
    inputWindow: objectValue(row.input_window),
    evidence: objectValue(row.evidence),
    explanation: row.explanation,
    explanationStatus: row.explanation_status as WorldStateIntelligenceAlert['explanationStatus'],
    metadata: objectValue(row.metadata),
    raw: row.raw_observation_id === null ? null : {
      rawObservationId: row.raw_observation_id,
      collectionRunId: row.collection_run_id,
      archivePath: row.archive_path,
      contentHash: row.content_hash,
    },
  };
}

function mapEvidenceEdgeRow(row: EvidenceEdgeRow): WorldStateEvidenceEdge {
  return {
    id: row.id,
    edgeKey: row.edge_key,
    from: mapEvidenceNode({
      id: row.from_node_id,
      nodeKey: row.from_node_key,
      nodeType: row.from_node_type,
      sourceId: row.from_source_id,
      externalId: row.from_external_id,
      label: row.from_label,
      evidenceClassification: row.from_evidence_classification,
      metadata: row.from_metadata,
    }),
    to: mapEvidenceNode({
      id: row.to_node_id,
      nodeKey: row.to_node_key,
      nodeType: row.to_node_type,
      sourceId: row.to_source_id,
      externalId: row.to_external_id,
      label: row.to_label,
      evidenceClassification: row.to_evidence_classification,
      metadata: row.to_metadata,
    }),
    relationType: row.relation_type as WorldStateEvidenceRelationType,
    sourceId: row.source_id,
    sourceName: row.source_name,
    provider: row.provider,
    effectiveFrom: timestamp(row.effective_from),
    effectiveTo: timestamp(row.effective_to),
    confidence: finiteNumber(row.confidence, 'confidence'),
    evidenceClassification: row.evidence_classification as WorldStateEvidenceClassification,
    derivationMethod: row.derivation_method,
    validationDate: row.validation_date,
    raw: row.raw_observation_id === null ? null : {
      rawObservationId: row.raw_observation_id,
      collectionRunId: row.collection_run_id,
      archivePath: row.archive_path,
      contentHash: row.content_hash,
    },
    metadata: objectValue(row.metadata),
  };
}

function mapEvidenceNode(input: {
  id: string;
  nodeKey: string;
  nodeType: string;
  sourceId: string | null;
  externalId: string | null;
  label: string;
  evidenceClassification: string;
  metadata: Record<string, unknown>;
}): WorldStateEvidenceNode {
  return {
    id: input.id,
    nodeKey: input.nodeKey,
    nodeType: input.nodeType as WorldStateEvidenceNodeType,
    sourceId: input.sourceId,
    externalId: input.externalId,
    label: input.label,
    evidenceClassification: input.evidenceClassification as WorldStateEvidenceClassification,
    metadata: objectValue(input.metadata),
  };
}

function detectMarketPriceMovementAlerts(
  rows: MarketAlertInputRow[],
  thresholds: { minSamples: number; thresholdPercent: number },
): MarketPriceAlertDetection {
  const grouped = new Map<string, MarketAlertInputRow[]>();
  for (const row of rows) {
    const key = `${row.source_id}\n${row.entity_type}\n${row.entity_id}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }

  const evaluatedAlertKeys: string[] = [];
  const candidates = Array.from(grouped.values()).flatMap((points) => {
    const ordered = points
      .filter((point) => Number.isFinite(point.price) && point.price > 0)
      .sort((left, right) => dateValue(left.observed_at) - dateValue(right.observed_at) || left.id.localeCompare(right.id));
    const latest = ordered[ordered.length - 1];
    if (latest === undefined) return [];
    const baseline = ordered.slice(0, -1);
    if (baseline.length < thresholds.minSamples) return [];
    const alertKey = marketPriceAlertKey(latest);
    evaluatedAlertKeys.push(alertKey);

    const baselinePrices = baseline.map((point) => point.price);
    const baselineMedian = median(baselinePrices);
    if (baselineMedian === null || baselineMedian <= 0) return [];

    const movementPercent = ((latest.price - baselineMedian) / baselineMedian) * 100;
    const absoluteMovementPercent = Math.abs(movementPercent);
    const deviations = baselinePrices.map((price) => Math.abs(price - baselineMedian));
    const medianAbsoluteDeviation = median(deviations);
    const robustZScore = medianAbsoluteDeviation !== null && medianAbsoluteDeviation > 0
      ? (latest.price - baselineMedian) / (1.4826 * medianAbsoluteDeviation)
      : null;
    const absoluteRobustZScore = robustZScore === null ? null : Math.abs(robustZScore);

    if (
      absoluteMovementPercent < thresholds.thresholdPercent
      || (absoluteRobustZScore !== null && absoluteRobustZScore < 3)
    ) {
      return [];
    }

    const direction = movementPercent >= 0 ? 'above' : 'below';
    const displayName = latest.display_name || latest.entity_id;
    const severity: WorldStateAlertSeverity =
      absoluteMovementPercent >= thresholds.thresholdPercent * 3
      || (absoluteRobustZScore !== null && absoluteRobustZScore >= 6)
        ? 'critical'
        : 'warning';
    const windowStart = dateObject(ordered[0]?.observed_at, 'observed_at');
    const windowEnd = dateObject(latest.observed_at, 'observed_at');
    const roundedMovement = roundNumber(movementPercent, 2);
    const roundedPrice = roundNumber(latest.price, 4);
    const roundedMedian = roundNumber(baselineMedian, 4);

    return [{
      alertKey,
      kind: 'market_price_movement',
      severity,
      sourceId: latest.source_id,
      sourceName: latest.source_name,
      provider: latest.provider,
      entityType: latest.entity_type as MarketPriceAlertCandidate['entityType'],
      entityId: latest.entity_id,
      title: `${displayName} price moved ${Math.abs(roundedMovement)}% ${direction} baseline`,
      detail: `${displayName} latest price ${formatPrice(roundedPrice, latest.currency)} is ${Math.abs(roundedMovement)}% ${direction} the ${baseline.length}-sample median ${formatPrice(roundedMedian, latest.currency)}.`,
      detectedAt: windowEnd,
      windowStart,
      windowEnd,
      thresholds: {
        minSamples: thresholds.minSamples,
        thresholdPercent: thresholds.thresholdPercent,
        robustZScore: 3,
        criticalMovementMultiplier: 3,
        criticalRobustZScore: 6,
      },
      inputWindow: {
        baselineSamples: baseline.length,
        latest: marketAlertPoint(latest),
        baseline: baseline.map(marketAlertPoint),
        baselineMedian: roundedMedian,
        baselineMin: roundNumber(Math.min(...baselinePrices), 4),
        baselineMax: roundNumber(Math.max(...baselinePrices), 4),
        medianAbsoluteDeviation: medianAbsoluteDeviation === null ? null : roundNumber(medianAbsoluteDeviation, 4),
        movementPercent: roundedMovement,
        robustZScore: robustZScore === null ? null : roundNumber(robustZScore, 4),
      },
      evidence: {
        latestRawObservationId: latest.raw_observation_id,
        latestCollectionRunId: latest.collection_run_id,
        latestArchivePath: latest.archive_path,
        latestContentHash: latest.content_hash,
        evidenceClassification: 'derived',
        baselineObservationCount: baseline.length,
      },
      explanation: `Derived from observed price history using a median baseline. This is a statistical anomaly signal, not a causal explanation.`,
      explanationStatus: 'unexplained',
      rawObservationId: latest.raw_observation_id,
      metadata: {
        sourceName: latest.source_name,
        provider: latest.provider,
        displayName,
        currency: latest.currency,
        calculationGeneratedAt: windowEnd.toISOString(),
      },
    } satisfies MarketPriceAlertCandidate];
  });

  return {
    candidates,
    evaluatedAlertKeys,
  };
}

function marketPriceAlertKey(row: Pick<MarketAlertInputRow, 'source_id' | 'entity_type' | 'entity_id'>): string {
  return `market_price_movement:${row.source_id}:${row.entity_type}:${row.entity_id}`;
}

function marketAlertPoint(point: MarketAlertInputRow): Record<string, unknown> {
  return {
    observedAt: requiredTimestamp(point.observed_at, 'observed_at'),
    price: roundNumber(point.price, 4),
    rawObservationId: point.raw_observation_id,
    collectionRunId: point.collection_run_id,
    archivePath: point.archive_path,
    contentHash: point.content_hash,
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  const middle = sorted[midpoint];
  if (middle === undefined) return null;
  if (sorted.length % 2 === 1) return middle;
  const previous = sorted[midpoint - 1];
  return previous === undefined ? middle : (previous + middle) / 2;
}

function roundNumber(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function formatPrice(value: number, currency: string | null): string {
  return currency ? `${value} ${currency.toUpperCase()}` : String(value);
}

function mapRawObservationRow(row: RawObservationRow): WorldStateRawObservation {
  return {
    id: row.id,
    sourceId: row.source_id,
    collectionRunId: row.collection_run_id,
    sourceRecordId: row.source_record_id,
    observedAt: requiredTimestamp(row.observed_at, 'observed_at'),
    occurredAt: timestamp(row.occurred_at),
    sourceUpdatedAt: timestamp(row.source_updated_at),
    firstSeenAt: requiredTimestamp(row.first_seen_at, 'first_seen_at'),
    lastSeenAt: requiredTimestamp(row.last_seen_at, 'last_seen_at'),
    contentHash: row.content_hash,
    archivePath: row.archive_path,
    payload: row.payload,
    schemaVersion: row.schema_version,
    parserVersion: row.parser_version,
    evidenceClassification: row.evidence_classification as WorldStateRawObservation['evidenceClassification'],
    metadata: objectValue(row.metadata),
  };
}

function mapRawObservationSummaryRow(row: RawObservationSummaryRow): WorldStateRawObservationSummary {
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceName: row.source_name,
    provider: row.provider,
    collectionRunId: row.collection_run_id,
    sourceRecordId: row.source_record_id,
    observedAt: requiredTimestamp(row.observed_at, 'observed_at'),
    occurredAt: timestamp(row.occurred_at),
    sourceUpdatedAt: timestamp(row.source_updated_at),
    firstSeenAt: requiredTimestamp(row.first_seen_at, 'first_seen_at'),
    lastSeenAt: requiredTimestamp(row.last_seen_at, 'last_seen_at'),
    contentHash: row.content_hash,
    archivePath: row.archive_path,
    schemaVersion: row.schema_version,
    parserVersion: row.parser_version,
    evidenceClassification: row.evidence_classification as WorldStateRawObservationSummary['evidenceClassification'],
    metadata: objectValue(row.metadata),
  };
}

function mapOperationsTotalsRow(row: OperationsTotalsRow | undefined): WorldStateOperationsTotals {
  return {
    sources: row?.sources ?? 0,
    activeSources: row?.active_sources ?? 0,
    runs: row?.runs ?? 0,
    successfulRuns: row?.successful_runs ?? 0,
    failedRuns: row?.failed_runs ?? 0,
    rawObservations: row?.raw_observations ?? 0,
    latestRunStartedAt: timestamp(row?.latest_run_started_at),
    latestRunCompletedAt: timestamp(row?.latest_run_completed_at),
  };
}

function mapOperationsStatusRow(row: OperationsStatusRow): WorldStateOperationsStatusCount {
  return {
    status: row.status,
    count: row.count,
  };
}

function mapOperationsSourceHealthRow(row: OperationsSourceHealthRow): WorldStateOperationsSourceHealth {
  return {
    sourceId: row.source_id,
    name: row.name,
    provider: row.provider,
    status: row.status,
    latestRunId: row.latest_run_id,
    latestRunStatus: row.latest_run_status,
    latestRunStartedAt: timestamp(row.latest_run_started_at),
    latestRunCompletedAt: timestamp(row.latest_run_completed_at),
    latestRunError: row.latest_run_error,
    runs: row.runs,
    successfulRuns: row.successful_runs,
    failedRuns: row.failed_runs,
    rawObservations: row.raw_observations,
    successRate: row.runs > 0 ? row.successful_runs / row.runs : null,
  };
}

function mapReadinessSummaryRow(row: ReadinessRow | undefined): WorldStateReadinessSummary {
  if (!row) {
    return {
      expectedMigrations: EXPECTED_MIGRATION_COUNT,
      migrationsApplied: 0,
      latestMigration: null,
      latestMigrationAppliedAt: null,
      sources: 0,
      activeSources: 0,
      runs: 0,
      successfulRuns: 0,
      failedRuns: 0,
      runningRuns: 0,
      rawObservations: 0,
      archivedRawObservations: 0,
      events: 0,
      latestRunId: null,
      latestRunStatus: null,
      latestRunStartedAt: null,
      latestRunCompletedAt: null,
      latestRawObservedAt: null,
    };
  }

  return {
    expectedMigrations: EXPECTED_MIGRATION_COUNT,
    migrationsApplied: row.migrations_applied,
    latestMigration: row.latest_migration,
    latestMigrationAppliedAt: timestamp(row.latest_migration_applied_at),
    sources: row.sources,
    activeSources: row.active_sources,
    runs: row.runs,
    successfulRuns: row.successful_runs,
    failedRuns: row.failed_runs,
    runningRuns: row.running_runs,
    rawObservations: row.raw_observations,
    archivedRawObservations: row.archived_raw_observations,
    events: row.events,
    latestRunId: row.latest_run_id,
    latestRunStatus: row.latest_run_status,
    latestRunStartedAt: timestamp(row.latest_run_started_at),
    latestRunCompletedAt: timestamp(row.latest_run_completed_at),
    latestRawObservedAt: timestamp(row.latest_raw_observed_at),
  };
}

const READINESS_COMPOSE_COMMAND = 'docker compose -f docker-compose.yml -f docker-compose.worldstate.yml';

function readinessChecks(summary: WorldStateReadinessSummary): WorldStateReadinessCheck[] {
  const migrationsStatus: WorldStateReadinessStatus = summary.migrationsApplied >= EXPECTED_MIGRATION_COUNT && summary.latestMigration === EXPECTED_LATEST_MIGRATION ? 'ready' : 'not_ready';
  const sourcesStatus: WorldStateReadinessStatus = summary.activeSources > 0 ? 'ready' : summary.sources > 0 ? 'degraded' : 'not_ready';
  const runsStatus = collectorRunsStatus(summary);
  const archiveStatus = rawArchiveStatus(summary);
  const eventsStatus: WorldStateReadinessStatus = summary.events > 0 ? 'ready' : summary.rawObservations > 0 ? 'degraded' : 'not_ready';

  return [
    {
      id: 'migrations',
      label: 'Database migrations',
      status: migrationsStatus,
      detail: summary.latestMigration
        ? `${summary.migrationsApplied}/${EXPECTED_MIGRATION_COUNT} migrations applied; latest is ${summary.latestMigration}.`
        : 'schema_migrations is empty; run the World-State migrations.',
      remediation: migrationsStatus === 'ready' ? [] : [
        `Apply the World-State migrations: ${READINESS_COMPOSE_COMMAND} run --rm migrate`,
        `The schema should reach ${EXPECTED_MIGRATION_COUNT} migrations ending at ${EXPECTED_LATEST_MIGRATION}; re-check /api/v1/readiness afterwards.`,
      ],
    },
    {
      id: 'sources',
      label: 'Source catalogue',
      status: sourcesStatus,
      detail: `${summary.activeSources}/${summary.sources} sources are active.`,
      remediation: sourcesStatus === 'ready' ? [] : sourcesStatus === 'degraded' ? [
        'Sources exist but none are active; inspect /api/v1/sources and re-activate the required rows in source_catalogue.',
      ] : [
        `Migrations seed the source catalogue; apply them first: ${READINESS_COMPOSE_COMMAND} run --rm migrate`,
        'Then confirm /api/v1/sources lists the expected collector sources.',
      ],
    },
    {
      id: 'collector-runs',
      label: 'Collector runs',
      status: runsStatus,
      detail: summary.latestRunStartedAt
        ? `${summary.runs} runs recorded; latest ${summary.latestRunStatus ?? 'unknown'} at ${summary.latestRunStartedAt}.`
        : 'No collector runs have been recorded yet.',
      remediation: runsStatus === 'ready' ? [] : runsStatus === 'degraded' ? [
        `Inspect recent collector activity: ${READINESS_COMPOSE_COMMAND} logs collector`,
        'Review /api/v1/operations/alerts for failed, stale or low-yield sources.',
      ] : [
        `Check that the collector service is running: ${READINESS_COMPOSE_COMMAND} ps collector`,
        `Inspect collector startup output: ${READINESS_COMPOSE_COMMAND} logs collector`,
        'Confirm COLLECT_ON_STARTUP=1 in .env and allow one collection cycle to complete.',
      ],
    },
    {
      id: 'raw-archive',
      label: 'Raw archive evidence',
      status: archiveStatus,
      detail: `${summary.archivedRawObservations}/${summary.rawObservations} raw observations have archive paths.`,
      remediation: archiveStatus === 'ready' ? [] : summary.rawObservations === 0 ? [
        'No raw observations exist yet; resolve the collector-runs check first.',
        `Verify the archive mount is writable before the next cycle: ${READINESS_COMPOSE_COMMAND} run --rm archive-check`,
      ] : [
        `Verify the archive mount is writable by the collector identity: ${READINESS_COMPOSE_COMMAND} run --rm archive-check`,
        'Check that RAW_ARCHIVE_HOST_PATH in .env points at the mounted archive directory and is owned by COLLECTOR_UID:COLLECTOR_GID.',
        `Inspect collector archive errors: ${READINESS_COMPOSE_COMMAND} logs collector`,
      ],
    },
    {
      id: 'normalised-events',
      label: 'Normalised events',
      status: eventsStatus,
      detail: summary.events > 0
        ? `${summary.events} normalised events are available to the World-State explorer.`
        : 'No normalised event rows are available yet.',
      remediation: eventsStatus === 'ready' ? [] : eventsStatus === 'degraded' ? [
        'Raw observations exist without normalised events; inspect /api/v1/runs?status=failed for parse/normalise failures.',
        `Check collector normaliser errors: ${READINESS_COMPOSE_COMMAND} logs collector`,
        'Drill into a recent run with /api/v1/runs/<run-id>/raw to compare archived payloads against normalised output.',
      ] : [
        'Events normalise from raw observations; resolve the collector-runs and raw-archive checks first.',
      ],
    },
  ];
}

function collectorRunsStatus(summary: WorldStateReadinessSummary): WorldStateReadinessStatus {
  if (summary.runs === 0) return 'not_ready';
  if (summary.latestRunStatus === 'succeeded' && summary.successfulRuns > 0) return 'ready';
  if (summary.runningRuns > 0 || summary.successfulRuns > 0) return 'degraded';
  return 'not_ready';
}

function rawArchiveStatus(summary: WorldStateReadinessSummary): WorldStateReadinessStatus {
  if (summary.rawObservations === 0) return 'not_ready';
  if (summary.archivedRawObservations === summary.rawObservations) return 'ready';
  if (summary.archivedRawObservations > 0) return 'degraded';
  return 'not_ready';
}

function aggregateReadinessStatus(checks: WorldStateReadinessCheck[]): WorldStateReadinessStatus {
  if (checks.some((check) => check.status === 'not_ready')) return 'not_ready';
  if (checks.some((check) => check.status === 'degraded')) return 'degraded';
  return 'ready';
}

function mapCoverageCategoryRow(row: CoverageCategoryRow): WorldStateCoverageCategory {
  return {
    category: row.category as WorldStateEventCategory,
    events: row.events,
    sources: row.sources,
    earliestOccurredAt: timestamp(row.earliest_occurred_at),
    latestOccurredAt: timestamp(row.latest_occurred_at),
    latestObservedAt: timestamp(row.latest_observed_at),
    bounds: coverageBounds(row),
  };
}

function mapCoverageSourceRow(row: CoverageSourceRow): WorldStateCoverageSource {
  const categoryCounts = objectValue(row.category_counts);
  const categories = Object.fromEntries(
    Object.entries(categoryCounts)
      .filter(([category, value]) => EVENT_CATEGORIES.has(category as WorldStateEventCategory) && typeof value === 'number')
      .map(([category, value]) => [category, value as number]),
  ) as Partial<Record<WorldStateEventCategory, number>>;

  return {
    sourceId: row.source_id,
    name: row.name,
    provider: row.provider,
    events: row.events,
    quotes: row.quotes,
    rawObservations: row.raw_observations,
    latestEventAt: timestamp(row.latest_event_at),
    latestQuoteAt: timestamp(row.latest_quote_at),
    latestRawObservedAt: timestamp(row.latest_raw_observed_at),
    categories,
  };
}

function mapCoverageTimelineRow(row: CoverageTimelineRow): WorldStateCoverageTimelineBucket {
  return {
    bucketStart: requiredTimestamp(row.bucket_start, 'bucket_start'),
    events: row.events,
    rawObservations: row.raw_observations,
    runs: row.runs,
  };
}

function coverageBounds(row: CoverageCategoryRow): WorldStateCoverageBounds | null {
  if (row.south === null || row.west === null || row.north === null || row.east === null) {
    return null;
  }
  return {
    south: finiteNumber(row.south, 'south'),
    west: finiteNumber(row.west, 'west'),
    north: finiteNumber(row.north, 'north'),
    east: finiteNumber(row.east, 'east'),
  };
}

function mapOperationsAlertsRow(row: OperationsAlertRow, since: Date): WorldStateOperationsAlert[] {
  const alerts: WorldStateOperationsAlert[] = [];
  const latestStartedAt = timestamp(row.latest_run_started_at);
  const latestCompletedAt = timestamp(row.latest_run_completed_at);
  const successRate = row.runs > 0 ? row.successful_runs / row.runs : null;

  if (row.latest_run_status === 'failed') {
    alerts.push(operationAlert(row, {
      kind: 'source_failed',
      severity: 'critical',
      title: `${row.name} latest run failed`,
      detail: `Latest collector run failed after ${row.successful_runs.toLocaleString()} successful and ${row.failed_runs.toLocaleString()} failed historical runs.`,
      successRate,
      latestStartedAt,
      latestCompletedAt,
    }));
  }

  if (row.status === 'active' && row.recent_runs === 0) {
    alerts.push(operationAlert(row, {
      kind: 'source_stale',
      severity: row.latest_run_id === null ? 'critical' : 'warning',
      title: `${row.name} has no recent runs`,
      detail: `No collection run has started since ${since.toISOString()}.`,
      successRate,
      latestStartedAt,
      latestCompletedAt,
    }));
  }

  if (row.recent_runs > 0 && row.recent_raw_observations === 0) {
    alerts.push(operationAlert(row, {
      kind: 'no_recent_raw',
      severity: 'warning',
      title: `${row.name} produced no recent raw observations`,
      detail: `${row.recent_runs.toLocaleString()} recent run(s) produced no raw observations since ${since.toISOString()}.`,
      successRate,
      latestStartedAt,
      latestCompletedAt,
    }));
  }

  if (row.runs >= 3 && successRate !== null && successRate < 0.8) {
    alerts.push(operationAlert(row, {
      kind: 'low_success_rate',
      severity: successRate < 0.5 ? 'critical' : 'warning',
      title: `${row.name} success rate is low`,
      detail: `Historical success rate is ${Math.round(successRate * 100)}% across ${row.runs.toLocaleString()} runs.`,
      successRate,
      latestStartedAt,
      latestCompletedAt,
    }));
  }

  return alerts;
}

function operationAlert(
  row: OperationsAlertRow,
  input: {
    kind: WorldStateOperationsAlert['kind'];
    severity: WorldStateOperationsAlertSeverity;
    title: string;
    detail: string;
    successRate: number | null;
    latestStartedAt: string | null;
    latestCompletedAt: string | null;
  },
): WorldStateOperationsAlert {
  return {
    id: `${row.source_id}:${input.kind}`,
    severity: input.severity,
    kind: input.kind,
    title: input.title,
    detail: input.detail,
    sourceId: row.source_id,
    sourceName: row.name,
    provider: row.provider,
    latestRunId: row.latest_run_id,
    latestRunStatus: row.latest_run_status,
    latestRunStartedAt: input.latestStartedAt,
    latestRunCompletedAt: input.latestCompletedAt,
    latestRunError: row.latest_run_error,
    successRate: input.successRate,
    recentRuns: row.recent_runs,
    recentFailures: row.recent_failed_runs,
    recentRawObservations: row.recent_raw_observations,
  };
}

function compareOperationsAlerts(left: WorldStateOperationsAlert, right: WorldStateOperationsAlert): number {
  const severityRank = (severity: WorldStateOperationsAlertSeverity) => {
    if (severity === 'critical') return 0;
    if (severity === 'warning') return 1;
    return 2;
  };
  return severityRank(left.severity) - severityRank(right.severity)
    || left.sourceName.localeCompare(right.sourceName)
    || left.kind.localeCompare(right.kind);
}

function mapCollectionRunRow(row: CollectionRunRow): WorldStateCollectionRun {
  return {
    id: row.id,
    sourceId: row.source_id,
    startedAt: requiredTimestamp(row.started_at, 'started_at'),
    requestStartedAt: timestamp(row.request_started_at),
    responseReceivedAt: timestamp(row.response_received_at),
    completedAt: timestamp(row.completed_at),
    upstreamTimestamp: timestamp(row.upstream_timestamp),
    retryNotBefore: timestamp(row.retry_not_before),
    status: row.status,
    endpoint: row.endpoint,
    httpStatus: row.http_status,
    contentType: row.content_type,
    contentHash: row.content_hash,
    archivePath: row.archive_path,
    responseHeaders: objectValue(row.response_headers),
    recordCount: row.record_count,
    collectorVersion: row.collector_version,
    parserVersion: row.parser_version,
    legacyProvenanceIncomplete: row.legacy_provenance_incomplete,
    error: row.error,
    metrics: objectValue(row.metrics),
  };
}

function mapCollectionRunListRow(row: CollectionRunListRow): WorldStateCollectionRunListItem {
  return {
    ...mapCollectionRunRow(row),
    rawObservationCount: row.raw_observation_count,
  };
}

function mapCollectionRunSummaryRow(row: CollectionRunSummaryRow): WorldStateCollectionRunSummary {
  return {
    ...mapCollectionRunListRow(row),
    sourceName: row.source_name,
    provider: row.provider,
  };
}

const SENSITIVE_VALUE_PATTERN = /key|token|secret|password|passwd|credential|signature|authorization|auth/i;
const MAX_SANITISED_STRING_LENGTH = 500;
const MAX_SANITISED_DEPTH = 6;

/**
 * Redact credentials from a collector endpoint URL: URL userinfo is dropped
 * and query values whose parameter name looks sensitive are replaced. Values
 * are never partially preserved. Non-URL text is returned unchanged.
 */
export function sanitiseCollectorEndpoint(endpoint: string): string {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return endpoint;
  }
  parsed.username = '';
  parsed.password = '';
  for (const name of Array.from(parsed.searchParams.keys())) {
    if (SENSITIVE_VALUE_PATTERN.test(name)) {
      parsed.searchParams.set(name, 'redacted');
    }
  }
  return parsed.toString();
}

/**
 * Sanitise a collector error payload for API exposure: values under
 * sensitive-looking keys are redacted, embedded URLs get endpoint
 * sanitisation, long strings are truncated and nesting depth is bounded.
 */
export function sanitiseCollectorError(error: unknown): Record<string, unknown> | null {
  if (error === null || error === undefined || typeof error !== 'object' || Array.isArray(error)) {
    return null;
  }
  return sanitiseErrorObject(error as Record<string, unknown>, 0);
}

function sanitiseErrorObject(value: Record<string, unknown>, depth: number): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_VALUE_PATTERN.test(key)) {
      result[key] = '[redacted]';
    } else {
      result[key] = sanitiseErrorValue(entry, depth + 1);
    }
  }
  return result;
}

function sanitiseErrorValue(value: unknown, depth: number): unknown {
  if (depth > MAX_SANITISED_DEPTH) {
    return '[truncated]';
  }
  if (typeof value === 'string') {
    const sanitised = value.replace(/https?:\/\/[^\s"'<>]+/gi, (url) => sanitiseCollectorEndpoint(url));
    return sanitised.length > MAX_SANITISED_STRING_LENGTH
      ? `${sanitised.slice(0, MAX_SANITISED_STRING_LENGTH)}…`
      : sanitised;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => sanitiseErrorValue(entry, depth + 1));
  }
  if (value !== null && typeof value === 'object') {
    return sanitiseErrorObject(value as Record<string, unknown>, depth);
  }
  return value;
}

function mapDiagnosticsFailingSourceRow(row: DiagnosticsFailingSourceRow): WorldStateCollectorFailingSource {
  return {
    sourceId: row.source_id,
    sourceName: row.name,
    provider: row.provider,
    sourceStatus: row.status,
    recentRuns: row.recent_runs,
    recentFailedRuns: row.recent_failed_runs,
    latestRunStatus: row.latest_run_status,
    latestRunStartedAt: timestamp(row.latest_run_started_at),
    latestFailedRunId: row.latest_failed_run_id,
    latestFailureAt: timestamp(row.latest_failure_at),
    latestHttpStatus: row.latest_http_status,
    endpoint: sanitiseCollectorEndpoint(row.endpoint),
    archivePath: row.archive_path,
    error: sanitiseCollectorError(row.error),
  };
}

function mapDiagnosticsFailureRunRow(row: DiagnosticsFailureRunRow): WorldStateCollectorFailureRun {
  return {
    runId: row.run_id,
    sourceId: row.source_id,
    sourceName: row.source_name,
    provider: row.provider,
    startedAt: requiredTimestamp(row.started_at, 'started_at'),
    completedAt: timestamp(row.completed_at),
    httpStatus: row.http_status,
    endpoint: sanitiseCollectorEndpoint(row.endpoint),
    archivePath: row.archive_path,
    recordCount: row.record_count,
    error: sanitiseCollectorError(row.error),
  };
}

function timestamp(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return requiredTimestamp(value, 'timestamp');
}

function requiredTimestamp(value: Date | string, field: string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`Database returned invalid ${field}`);
  }
  return parsed.toISOString();
}

function dateObject(value: Date | string | undefined, field: string): Date {
  if (value === undefined) {
    throw new Error(`Database returned missing ${field}`);
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`Database returned invalid ${field}`);
  }
  return parsed;
}

function dateValue(value: Date | string): number {
  return dateObject(value, 'timestamp').getTime();
}

function finiteNumber(value: number, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Database returned invalid ${field}`);
  }
  return value;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
