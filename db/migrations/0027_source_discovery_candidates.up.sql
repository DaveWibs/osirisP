CREATE TABLE source_discovery_candidates (
    id UUID PRIMARY KEY,
    candidate_key TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    provider TEXT NOT NULL,
    endpoint_url TEXT NOT NULL,
    documentation_url TEXT,
    terms_url TEXT,
    licence TEXT,
    cost_class TEXT NOT NULL,
    access_method TEXT NOT NULL,
    status TEXT NOT NULL,
    evidence_classification TEXT NOT NULL,
    discovered_at TIMESTAMPTZ NOT NULL,
    last_reviewed_at TIMESTAMPTZ,
    reviewed_by TEXT,
    rationale TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT source_discovery_candidates_cost_class_check
        CHECK (cost_class IN ('free', 'free_tier', 'paid', 'unknown')),
    CONSTRAINT source_discovery_candidates_status_check
        CHECK (status IN ('candidate', 'needs_review', 'approved', 'rejected')),
    CONSTRAINT source_discovery_candidates_evidence_classification_check
        CHECK (evidence_classification IN ('observed', 'reported', 'derived', 'inferred', 'hypothesis')),
    CONSTRAINT source_discovery_candidates_endpoint_url_check
        CHECK (endpoint_url ~* '^https?://'),
    CONSTRAINT source_discovery_candidates_documentation_url_check
        CHECK (documentation_url IS NULL OR documentation_url ~* '^https?://'),
    CONSTRAINT source_discovery_candidates_terms_url_check
        CHECK (terms_url IS NULL OR terms_url ~* '^https?://')
);

CREATE INDEX source_discovery_candidates_status_idx
    ON source_discovery_candidates (status, discovered_at DESC);

CREATE INDEX source_discovery_candidates_provider_idx
    ON source_discovery_candidates (provider, discovered_at DESC);
