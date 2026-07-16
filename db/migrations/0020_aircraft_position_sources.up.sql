CREATE TABLE aircraft_position_observations (
    id UUID PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES source_catalogue(source_id),
    source_aircraft_id TEXT NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    icao24 TEXT NOT NULL,
    callsign TEXT,
    registration TEXT,
    aircraft_type TEXT,
    altitude_meters INTEGER,
    speed_knots DOUBLE PRECISION,
    heading DOUBLE PRECISION,
    squawk TEXT,
    nac_p INTEGER,
    military_flag BOOLEAN NOT NULL,
    geometry GEOMETRY(Point, 4326) NOT NULL,
    raw_observation_id UUID NOT NULL,
    evidence_classification TEXT NOT NULL,
    parser_version TEXT NOT NULL,
    normalised_at TIMESTAMPTZ NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT aircraft_position_observations_source_aircraft_unique
        UNIQUE (source_id, source_aircraft_id),
    CONSTRAINT aircraft_position_observations_raw_observation_fk
        FOREIGN KEY (raw_observation_id, source_id)
        REFERENCES raw_observations(id, source_id),
    CONSTRAINT aircraft_position_observations_source_check
        CHECK (source_id IN ('airplanes-live-military')),
    CONSTRAINT aircraft_position_observations_icao24_check
        CHECK (icao24 ~ '^[0-9a-f]{6}$'),
    CONSTRAINT aircraft_position_observations_evidence_classification_check
        CHECK (evidence_classification IN ('observed', 'reported', 'derived', 'inferred', 'hypothesis')),
    CONSTRAINT aircraft_position_observations_updated_check
        CHECK (updated_at >= observed_at)
);

CREATE INDEX aircraft_position_observations_source_time_idx
    ON aircraft_position_observations (source_id, observed_at DESC);

CREATE INDEX aircraft_position_observations_icao_time_idx
    ON aircraft_position_observations (icao24, observed_at DESC);

CREATE INDEX aircraft_position_observations_geometry_idx
    ON aircraft_position_observations USING GIST (geometry);

CREATE INDEX aircraft_position_observations_metadata_gin_idx
    ON aircraft_position_observations USING GIN (metadata);

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
    'airplanes-live-military',
    'airplanes.live Military ADS-B Feed',
    'airplanes.live',
    'Global military aircraft feed used by the existing OSIRIS aviation layer.',
    'https_json',
    'free',
    'airplanes.live public feeder data; follow provider terms and preserve attribution.',
    'https://airplanes.live/',
    'https://api.airplanes.live/v2/mil',
    'active',
    NOW(),
    jsonb_build_object(
        'endpoint', 'https://api.airplanes.live/v2/mil',
        'format', 'JSON',
        'provenance_classification', 'observed',
        'rate_limit_notes', 'Public endpoint; collect conservatively and preserve raw responses.',
        'timestamp_semantics', 'provider now timestamp is treated as observed_at and source update time when present.',
        'stable_identifier_notes', 'ICAO24 hex is used as the stable source aircraft identifier.',
        'slice_scope', 'First aviation persistence slice; other ADS-B global and regional feeds can reuse aircraft_position_observations.'
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
