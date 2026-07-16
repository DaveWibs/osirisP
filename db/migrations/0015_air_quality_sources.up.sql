CREATE TABLE air_quality_observations (
    id UUID PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES source_catalogue(source_id),
    source_station_id TEXT NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    location_name TEXT NOT NULL,
    city TEXT,
    country_code TEXT NOT NULL,
    parameter TEXT NOT NULL,
    measurement_value DOUBLE PRECISION NOT NULL,
    unit TEXT NOT NULL,
    level TEXT NOT NULL,
    geometry GEOMETRY(Point, 4326) NOT NULL,
    raw_observation_id UUID NOT NULL,
    evidence_classification TEXT NOT NULL,
    parser_version TEXT NOT NULL,
    normalised_at TIMESTAMPTZ NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT air_quality_observations_source_station_unique
        UNIQUE (source_id, source_station_id),
    CONSTRAINT air_quality_observations_raw_observation_fk
        FOREIGN KEY (raw_observation_id, source_id)
        REFERENCES raw_observations(id, source_id),
    CONSTRAINT air_quality_observations_parameter_check
        CHECK (parameter IN ('pm25')),
    CONSTRAINT air_quality_observations_level_check
        CHECK (level IN ('Good', 'Moderate', 'Unhealthy (Sensitive)', 'Unhealthy', 'Hazardous')),
    CONSTRAINT air_quality_observations_evidence_classification_check
        CHECK (evidence_classification IN ('observed', 'reported', 'derived', 'inferred', 'hypothesis')),
    CONSTRAINT air_quality_observations_updated_check
        CHECK (updated_at >= observed_at)
);

CREATE INDEX air_quality_observations_source_time_idx
    ON air_quality_observations (source_id, observed_at DESC);

CREATE INDEX air_quality_observations_geometry_idx
    ON air_quality_observations USING GIST (geometry);

CREATE INDEX air_quality_observations_country_level_idx
    ON air_quality_observations (country_code, level);

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
    'openaq-latest-pm25',
    'OpenAQ Latest PM2.5 Measurements',
    'OpenAQ',
    'Latest global PM2.5 air-quality measurements used by the existing OSIRIS air-quality route.',
    'https_json',
    'free',
    'OpenAQ public data; follow OpenAQ terms and preserve attribution.',
    'https://openaq.org/terms/',
    'https://docs.openaq.org/',
    'active',
    NOW(),
    jsonb_build_object(
        'endpoint', 'https://api.openaq.org/v2/latest?limit=500&parameter=pm25&order_by=lastUpdated&sort=desc',
        'format', 'JSON',
        'provenance_classification', 'observed',
        'rate_limit_notes', 'Public API; collect conservatively and preserve raw responses.',
        'timestamp_semantics', 'measurement lastUpdated is treated as observed_at and source update time.',
        'stable_identifier_notes', 'locationId plus pm25 is used when available; otherwise country, location and coordinates form the stable station identifier.'
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
