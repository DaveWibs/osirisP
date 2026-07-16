CREATE TABLE news_article_observations (
    id UUID PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES source_catalogue(source_id),
    source_article_id TEXT NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    published_at TIMESTAMPTZ NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    link TEXT,
    provider TEXT NOT NULL,
    feed_name TEXT NOT NULL,
    raw_observation_id UUID NOT NULL,
    evidence_classification TEXT NOT NULL,
    parser_version TEXT NOT NULL,
    normalised_at TIMESTAMPTZ NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT news_article_observations_source_article_unique
        UNIQUE (source_id, source_article_id),
    CONSTRAINT news_article_observations_raw_observation_fk
        FOREIGN KEY (raw_observation_id, source_id)
        REFERENCES raw_observations(id, source_id),
    CONSTRAINT news_article_observations_source_check
        CHECK (source_id IN ('bbc-world-rss', 'aljazeera-all-rss', 'gdacs-news-rss')),
    CONSTRAINT news_article_observations_evidence_classification_check
        CHECK (evidence_classification IN ('observed', 'reported', 'derived', 'inferred', 'hypothesis')),
    CONSTRAINT news_article_observations_updated_check
        CHECK (updated_at >= observed_at)
);

CREATE INDEX news_article_observations_source_published_idx
    ON news_article_observations (source_id, published_at DESC);

CREATE INDEX news_article_observations_provider_published_idx
    ON news_article_observations (provider, published_at DESC);

CREATE INDEX news_article_observations_metadata_gin_idx
    ON news_article_observations USING GIN (metadata);

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
    'bbc-world-rss',
    'BBC World News RSS',
    'BBC',
    'BBC World RSS headlines used by the existing OSIRIS news fallback route.',
    'https_rss',
    'free',
    'BBC public RSS feed; follow BBC terms and attribution requirements.',
    'https://www.bbc.co.uk/usingthebbc/terms/',
    'https://feeds.bbci.co.uk/news/world/rss.xml',
    'active',
    NOW(),
    jsonb_build_object(
        'endpoint', 'https://feeds.bbci.co.uk/news/world/rss.xml',
        'format', 'RSS',
        'provenance_classification', 'reported',
        'rate_limit_notes', 'Public RSS feed; collect conservatively and preserve raw items.',
        'timestamp_semantics', 'item pubDate is treated as published_at, observed_at and source update time.',
        'stable_identifier_notes', 'Article link is hashed as the stable source article identifier; title and timestamp are used only when link is absent.'
    )
),
(
    'aljazeera-all-rss',
    'Al Jazeera All News RSS',
    'Al Jazeera',
    'Al Jazeera all-news RSS headlines used by the existing OSIRIS news fallback route.',
    'https_rss',
    'free',
    'Al Jazeera public RSS feed; follow Al Jazeera terms and attribution requirements.',
    'https://www.aljazeera.com/terms-and-conditions/',
    'https://www.aljazeera.com/xml/rss/all.xml',
    'active',
    NOW(),
    jsonb_build_object(
        'endpoint', 'https://www.aljazeera.com/xml/rss/all.xml',
        'format', 'RSS',
        'provenance_classification', 'reported',
        'rate_limit_notes', 'Public RSS feed; collect conservatively and preserve raw items.',
        'timestamp_semantics', 'item pubDate is treated as published_at, observed_at and source update time.',
        'stable_identifier_notes', 'Article link is hashed as the stable source article identifier; title and timestamp are used only when link is absent.'
    )
),
(
    'gdacs-news-rss',
    'GDACS News RSS',
    'GDACS',
    'GDACS RSS alerts mirrored into the news fallback capture path for operational continuity.',
    'https_rss',
    'free',
    'GDACS public RSS feed; follow GDACS terms and preserve attribution.',
    'https://www.gdacs.org/',
    'https://www.gdacs.org/xml/rss.xml',
    'active',
    NOW(),
    jsonb_build_object(
        'endpoint', 'https://www.gdacs.org/xml/rss.xml',
        'format', 'RSS',
        'provenance_classification', 'reported',
        'rate_limit_notes', 'Public RSS feed; collect conservatively and preserve raw items.',
        'timestamp_semantics', 'item pubDate is treated as published_at, observed_at and source update time.',
        'stable_identifier_notes', 'Article link is hashed as the stable source article identifier; title and timestamp are used only when link is absent.'
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
