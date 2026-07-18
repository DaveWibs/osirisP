CREATE TABLE crypto_price_history (
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
    CONSTRAINT crypto_price_history_source_asset_observed_unique
        UNIQUE (source_id, source_asset_id, observed_at),
    CONSTRAINT crypto_price_history_raw_observation_fk
        FOREIGN KEY (raw_observation_id, source_id)
        REFERENCES raw_observations(id, source_id),
    CONSTRAINT crypto_price_history_source_check
        CHECK (source_id IN ('coingecko-simple-price')),
    CONSTRAINT crypto_price_history_asset_check
        CHECK (asset_id IN ('bitcoin', 'ethereum', 'solana')),
    CONSTRAINT crypto_price_history_symbol_check
        CHECK (symbol IN ('BTC', 'ETH', 'SOL')),
    CONSTRAINT crypto_price_history_currency_check
        CHECK (currency = 'usd'),
    CONSTRAINT crypto_price_history_price_check
        CHECK (price >= 0),
    CONSTRAINT crypto_price_history_evidence_classification_check
        CHECK (evidence_classification IN ('observed', 'reported', 'derived', 'inferred', 'hypothesis')),
    CONSTRAINT crypto_price_history_updated_check
        CHECK (updated_at >= observed_at)
);

CREATE INDEX crypto_price_history_symbol_time_idx
    ON crypto_price_history (symbol, observed_at DESC);

CREATE TABLE market_quote_history (
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
    CONSTRAINT market_quote_history_source_quote_observed_unique
        UNIQUE (source_id, source_quote_id, observed_at),
    CONSTRAINT market_quote_history_raw_observation_fk
        FOREIGN KEY (raw_observation_id, source_id)
        REFERENCES raw_observations(id, source_id),
    CONSTRAINT market_quote_history_source_check
        CHECK (source_id IN ('yahoo-finance-market-quotes')),
    CONSTRAINT market_quote_history_price_check
        CHECK (price >= 0),
    CONSTRAINT market_quote_history_evidence_classification_check
        CHECK (evidence_classification IN ('observed', 'reported', 'derived', 'inferred', 'hypothesis')),
    CONSTRAINT market_quote_history_updated_check
        CHECK (updated_at >= observed_at)
);

CREATE INDEX market_quote_history_symbol_time_idx
    ON market_quote_history (symbol, observed_at DESC);

CREATE TABLE intelligence_alerts (
    id UUID PRIMARY KEY,
    alert_key TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    severity TEXT NOT NULL,
    status TEXT NOT NULL,
    source_id TEXT NOT NULL REFERENCES source_catalogue(source_id),
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    title TEXT NOT NULL,
    detail TEXT NOT NULL,
    detected_at TIMESTAMPTZ NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    window_end TIMESTAMPTZ NOT NULL,
    evidence_classification TEXT NOT NULL,
    method TEXT NOT NULL,
    calculation_version TEXT NOT NULL,
    thresholds JSONB NOT NULL,
    input_window JSONB NOT NULL,
    evidence JSONB NOT NULL,
    explanation TEXT NOT NULL,
    explanation_status TEXT NOT NULL,
    raw_observation_id UUID,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT intelligence_alerts_kind_check
        CHECK (kind IN ('market_price_movement')),
    CONSTRAINT intelligence_alerts_severity_check
        CHECK (severity IN ('info', 'warning', 'critical')),
    CONSTRAINT intelligence_alerts_status_check
        CHECK (status IN ('active', 'resolved')),
    CONSTRAINT intelligence_alerts_entity_type_check
        CHECK (entity_type IN ('crypto_asset', 'market_symbol')),
    CONSTRAINT intelligence_alerts_evidence_classification_check
        CHECK (evidence_classification IN ('observed', 'reported', 'derived', 'inferred', 'hypothesis')),
    CONSTRAINT intelligence_alerts_explanation_status_check
        CHECK (explanation_status IN ('explained', 'unexplained')),
    CONSTRAINT intelligence_alerts_window_check
        CHECK (window_end >= window_start),
    CONSTRAINT intelligence_alerts_raw_observation_fk
        FOREIGN KEY (raw_observation_id, source_id)
        REFERENCES raw_observations(id, source_id)
);

CREATE INDEX intelligence_alerts_status_detected_idx
    ON intelligence_alerts (status, detected_at DESC);

CREATE INDEX intelligence_alerts_kind_detected_idx
    ON intelligence_alerts (kind, detected_at DESC);

CREATE INDEX intelligence_alerts_source_detected_idx
    ON intelligence_alerts (source_id, detected_at DESC);

CREATE INDEX intelligence_alerts_entity_idx
    ON intelligence_alerts (entity_type, entity_id, detected_at DESC);
