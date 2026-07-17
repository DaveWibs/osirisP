import type { QueryResultRow } from 'pg';
import {
  type WorldStateEvent,
  type WorldStateEventCategory,
  type WorldStateEventsResponse,
  type WorldStateEventDetailResponse,
  type WorldStateMarketQuote,
  type WorldStateMarketQuotesResponse,
  type WorldStateSourceSummary,
  type WorldStateSourcesResponse,
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

export class WorldStateService {
  constructor(private readonly executor: WorldStateQueryExecutor) {}

  async listSources(now = new Date()): Promise<WorldStateSourcesResponse> {
    const result = await this.executor.query<SourceRow>(SOURCES_SQL, []);
    return {
      sources: result.rows.map(mapSourceRow),
      generatedAt: now.toISOString(),
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

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function uniqueValues<T extends string>(values: T[]): T[] {
  return Array.from(new Set(values));
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
