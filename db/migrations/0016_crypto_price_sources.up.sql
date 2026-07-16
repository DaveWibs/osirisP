CREATE TABLE crypto_price_observations (
    id UUID PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES source_catalogue(source_id),
    source_asset_id TEXT NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    asset_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    currency TEXT NOT NULL,
    price DOUBLE PRECISION NOT NULL,
    raw_observation_id UUID NOT NULL,
    evidence_classification TEXT NOT NULL,
    parser_version TEXT NOT NULL,
    normalised_at TIMESTAMPTZ NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT crypto_price_observations_source_asset_unique
        UNIQUE (source_id, source_asset_id),
    CONSTRAINT crypto_price_observations_raw_observation_fk
        FOREIGN KEY (raw_observation_id, source_id)
        REFERENCES raw_observations(id, source_id),
    CONSTRAINT crypto_price_observations_asset_check
        CHECK (asset_id IN ('bitcoin', 'ethereum', 'solana')),
    CONSTRAINT crypto_price_observations_symbol_check
        CHECK (symbol IN ('BTC', 'ETH', 'SOL')),
    CONSTRAINT crypto_price_observations_currency_check
        CHECK (currency = 'usd'),
    CONSTRAINT crypto_price_observations_price_check
        CHECK (price >= 0),
    CONSTRAINT crypto_price_observations_evidence_classification_check
        CHECK (evidence_classification IN ('observed', 'reported', 'derived', 'inferred', 'hypothesis')),
    CONSTRAINT crypto_price_observations_updated_check
        CHECK (updated_at >= observed_at)
);

CREATE INDEX crypto_price_observations_source_time_idx
    ON crypto_price_observations (source_id, observed_at DESC);

CREATE INDEX crypto_price_observations_symbol_time_idx
    ON crypto_price_observations (symbol, observed_at DESC);

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
    'coingecko-simple-price',
    'CoinGecko Simple Price BTC ETH SOL USD',
    'CoinGecko',
    'Simple USD spot prices for BTC, ETH and SOL used by the existing OSIRIS crypto route.',
    'https_json',
    'free',
    'CoinGecko public API; follow CoinGecko terms and attribution requirements.',
    'https://www.coingecko.com/en/terms',
    'https://docs.coingecko.com/reference/simple-price',
    'active',
    NOW(),
    jsonb_build_object(
        'endpoint', 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd',
        'format', 'JSON',
        'provenance_classification', 'observed',
        'rate_limit_notes', 'Public API; collect conservatively and preserve raw responses.',
        'timestamp_semantics', 'response_received_at is treated as observed_at because the simple price response does not include per-price timestamps.',
        'stable_identifier_notes', 'asset_id plus currency is used as the stable source asset identifier.'
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
