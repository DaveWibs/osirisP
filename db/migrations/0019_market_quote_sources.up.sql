CREATE TABLE market_quote_observations (
    id UUID PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES source_catalogue(source_id),
    source_quote_id TEXT NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    symbol TEXT NOT NULL,
    display_name TEXT NOT NULL,
    quote_type TEXT NOT NULL,
    currency TEXT,
    price DOUBLE PRECISION NOT NULL,
    change_percent DOUBLE PRECISION NOT NULL,
    up BOOLEAN NOT NULL,
    raw_observation_id UUID NOT NULL,
    evidence_classification TEXT NOT NULL,
    parser_version TEXT NOT NULL,
    normalised_at TIMESTAMPTZ NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT market_quote_observations_source_quote_unique
        UNIQUE (source_id, source_quote_id),
    CONSTRAINT market_quote_observations_raw_observation_fk
        FOREIGN KEY (raw_observation_id, source_id)
        REFERENCES raw_observations(id, source_id),
    CONSTRAINT market_quote_observations_source_check
        CHECK (source_id IN ('yahoo-finance-market-quotes')),
    CONSTRAINT market_quote_observations_price_check
        CHECK (price >= 0),
    CONSTRAINT market_quote_observations_evidence_classification_check
        CHECK (evidence_classification IN ('observed', 'reported', 'derived', 'inferred', 'hypothesis')),
    CONSTRAINT market_quote_observations_updated_check
        CHECK (updated_at >= observed_at)
);

CREATE INDEX market_quote_observations_symbol_time_idx
    ON market_quote_observations (symbol, observed_at DESC);

CREATE INDEX market_quote_observations_quote_type_idx
    ON market_quote_observations (quote_type, observed_at DESC);

CREATE INDEX market_quote_observations_metadata_gin_idx
    ON market_quote_observations USING GIN (metadata);

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
    'yahoo-finance-market-quotes',
    'Yahoo Finance Market Quotes',
    'Yahoo Finance',
    'Batched quote snapshots for defense stocks, commodities, energy futures, crypto tickers and index futures used by the existing OSIRIS markets route.',
    'https_json',
    'free',
    'Yahoo Finance public endpoint; follow Yahoo terms and attribution requirements.',
    'https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html',
    'https://query2.finance.yahoo.com/v6/finance/quote',
    'active',
    NOW(),
    jsonb_build_object(
        'endpoint', 'https://query2.finance.yahoo.com/v6/finance/quote?symbols=RTX,LMT,NOC,GD,BA,PLTR,CL%3DF,BZ%3DF,GC%3DF,SI%3DF,HG%3DF,NG%3DF,ZW%3DF,ZC%3DF,BTC-USD,ETH-USD,ES%3DF,NQ%3DF',
        'format', 'JSON',
        'provenance_classification', 'observed',
        'rate_limit_notes', 'Public endpoint; collect conservatively and preserve raw responses.',
        'timestamp_semantics', 'regularMarketTime is treated as source update time when present; response_received_at is treated as observed_at.',
        'stable_identifier_notes', 'Yahoo symbol is used as the stable source quote identifier.'
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
