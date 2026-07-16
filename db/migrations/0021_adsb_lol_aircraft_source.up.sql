ALTER TABLE aircraft_position_observations
    DROP CONSTRAINT aircraft_position_observations_source_check;

ALTER TABLE aircraft_position_observations
    ADD CONSTRAINT aircraft_position_observations_source_check
        CHECK (source_id IN ('airplanes-live-military', 'adsb-lol-military'));

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
    'adsb-lol-military',
    'adsb.lol Military ADS-B Feed',
    'adsb.lol',
    'Global military aircraft ADS-B feed used by the OSIRIS aviation layer.',
    'https_json',
    'free',
    'adsb.lol public feeder data; follow provider terms and preserve attribution.',
    'https://adsb.lol/',
    'https://api.adsb.lol/v2/mil',
    'active',
    NOW(),
    jsonb_build_object(
        'endpoint', 'https://api.adsb.lol/v2/mil',
        'format', 'JSON',
        'provenance_classification', 'observed',
        'rate_limit_notes', 'Public endpoint; collect conservatively and preserve raw responses.',
        'timestamp_semantics', 'provider now timestamp is treated as observed_at and source update time when present.',
        'stable_identifier_notes', 'ICAO24 hex is used as the stable source aircraft identifier.',
        'slice_scope', 'Second aviation persistence source reusing aircraft_position_observations alongside airplanes.live.'
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
