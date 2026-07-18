CREATE TABLE evidence_nodes (
    id UUID PRIMARY KEY,
    node_key TEXT NOT NULL UNIQUE,
    node_type TEXT NOT NULL,
    source_id TEXT REFERENCES source_catalogue(source_id),
    external_id TEXT,
    label TEXT NOT NULL,
    evidence_classification TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT evidence_nodes_type_check
        CHECK (node_type IN ('event', 'alert', 'market_symbol', 'crypto_asset', 'source', 'raw_observation', 'region', 'hypothesis')),
    CONSTRAINT evidence_nodes_evidence_classification_check
        CHECK (evidence_classification IN ('observed', 'reported', 'derived', 'inferred', 'hypothesis'))
);

CREATE INDEX evidence_nodes_type_idx
    ON evidence_nodes (node_type, node_key);

CREATE INDEX evidence_nodes_source_idx
    ON evidence_nodes (source_id, node_type);

CREATE TABLE evidence_edges (
    id UUID PRIMARY KEY,
    edge_key TEXT NOT NULL UNIQUE,
    from_node_id UUID NOT NULL REFERENCES evidence_nodes(id) ON DELETE CASCADE,
    to_node_id UUID NOT NULL REFERENCES evidence_nodes(id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL,
    source_id TEXT NOT NULL REFERENCES source_catalogue(source_id),
    effective_from TIMESTAMPTZ,
    effective_to TIMESTAMPTZ,
    confidence DOUBLE PRECISION NOT NULL,
    evidence_classification TEXT NOT NULL,
    derivation_method TEXT NOT NULL,
    validation_date DATE NOT NULL,
    raw_observation_id UUID,
    raw_observation_source_id TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT evidence_edges_relation_type_check
        CHECK (relation_type IN ('derived_from', 'supported_by', 'located_in', 'affects', 'associated_with', 'hypothesizes', 'source_observed')),
    CONSTRAINT evidence_edges_confidence_check
        CHECK (confidence >= 0 AND confidence <= 1),
    CONSTRAINT evidence_edges_evidence_classification_check
        CHECK (evidence_classification IN ('observed', 'reported', 'derived', 'inferred', 'hypothesis')),
    CONSTRAINT evidence_edges_effective_window_check
        CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from),
    CONSTRAINT evidence_edges_raw_reference_check
        CHECK (
            (raw_observation_id IS NULL AND raw_observation_source_id IS NULL)
            OR (raw_observation_id IS NOT NULL AND raw_observation_source_id IS NOT NULL)
        ),
    CONSTRAINT evidence_edges_raw_observation_fk
        FOREIGN KEY (raw_observation_id, raw_observation_source_id)
        REFERENCES raw_observations(id, source_id)
);

CREATE INDEX evidence_edges_from_node_idx
    ON evidence_edges (from_node_id, relation_type);

CREATE INDEX evidence_edges_to_node_idx
    ON evidence_edges (to_node_id, relation_type);

CREATE INDEX evidence_edges_source_idx
    ON evidence_edges (source_id, validation_date DESC);

CREATE INDEX evidence_edges_relation_idx
    ON evidence_edges (relation_type, validation_date DESC);
