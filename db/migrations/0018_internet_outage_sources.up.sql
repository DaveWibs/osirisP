CREATE TABLE internet_outage_observations (
    id UUID PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES source_catalogue(source_id),
    source_event_id TEXT NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    country_code TEXT NOT NULL,
    score DOUBLE PRECISION NOT NULL,
    severity TEXT NOT NULL,
    datasource TEXT NOT NULL,
    geometry GEOMETRY(Point, 4326) NOT NULL,
    raw_observation_id UUID NOT NULL,
    evidence_classification TEXT NOT NULL,
    parser_version TEXT NOT NULL,
    normalised_at TIMESTAMPTZ NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT internet_outage_observations_source_event_unique
        UNIQUE (source_id, source_event_id),
    CONSTRAINT internet_outage_observations_raw_observation_fk
        FOREIGN KEY (raw_observation_id, source_id)
        REFERENCES raw_observations(id, source_id),
    CONSTRAINT internet_outage_observations_source_check
        CHECK (source_id IN ('gatech-ioda-outages')),
    CONSTRAINT internet_outage_observations_country_code_check
        CHECK (country_code ~ '^[A-Z]{2}$'),
    CONSTRAINT internet_outage_observations_score_check
        CHECK (score >= 0),
    CONSTRAINT internet_outage_observations_evidence_classification_check
        CHECK (evidence_classification IN ('observed', 'reported', 'derived', 'inferred', 'hypothesis')),
    CONSTRAINT internet_outage_observations_updated_check
        CHECK (updated_at >= observed_at),
    CONSTRAINT internet_outage_observations_duration_check
        CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX internet_outage_observations_source_time_idx
    ON internet_outage_observations (source_id, observed_at DESC);

CREATE INDEX internet_outage_observations_country_time_idx
    ON internet_outage_observations (country_code, started_at DESC);

CREATE INDEX internet_outage_observations_geometry_idx
    ON internet_outage_observations USING GIST (geometry);

CREATE INDEX internet_outage_observations_metadata_gin_idx
    ON internet_outage_observations USING GIN (metadata);

INSERT INTO source_catalogue (
    source_id,
    name,
    provider,
    description,
    access_method,
    cost_class,
    licence,
    terms_url,
    documentation_url,
    status,
    last_reviewed_at,
    metadata
) VALUES
(
    'gatech-ioda-outages',
    'Georgia Tech IODA Country Outage Events',
    'Georgia Tech Internet Intelligence Lab',
    'Country-level internet outage events used by the existing OSIRIS radar outage route.',
    'https_json',
    'free',
    'IODA public API; follow Georgia Tech Internet Intelligence Lab terms and preserve attribution.',
    'https://ioda.inetintel.cc.gatech.edu/',
    'https://api.ioda.inetintel.cc.gatech.edu/v2/',
    'active',
    NOW(),
    jsonb_build_object(
        'endpoint', 'https://api.ioda.inetintel.cc.gatech.edu/v2/outages/events?entityType=country&limit=200',
        'format', 'JSON',
        'provenance_classification', 'observed',
        'rate_limit_notes', 'Public API; collect conservatively and preserve raw responses.',
        'timestamp_semantics', 'response_received_at is treated as observed_at and source update time; event start/duration are preserved as outage interval fields.',
        'stable_identifier_notes', 'location, start timestamp and datasource are hashed as the stable source event identifier.',
        'location_semantics', 'IODA country entities are represented by deterministic country centroids for map compatibility; metadata records locationPrecision=country_centroid.'
    )
)
ON CONFLICT (source_id) DO UPDATE SET
    name = EXCLUDED.name,
    provider = EXCLUDED.provider,
    description = EXCLUDED.description,
    access_method = EXCLUDED.access_method,
    cost_class = EXCLUDED.cost_class,
    licence = EXCLUDED.licence,
    terms_url = EXCLUDED.terms_url,
    documentation_url = EXCLUDED.documentation_url,
    status = EXCLUDED.status,
    updated_at = NOW(),
    last_reviewed_at = EXCLUDED.last_reviewed_at,
    metadata = EXCLUDED.metadata;
