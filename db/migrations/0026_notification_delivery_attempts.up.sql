CREATE TABLE notification_delivery_attempts (
    id UUID PRIMARY KEY,
    notification_id UUID NOT NULL REFERENCES notification_outbox(id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL,
    adapter TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ NOT NULL,
    http_status INTEGER,
    response_headers JSONB,
    response_body_hash TEXT,
    error JSONB,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT notification_delivery_attempts_unique
        UNIQUE (notification_id, attempt_number),
    CONSTRAINT notification_delivery_attempts_adapter_check
        CHECK (adapter IN ('telegram')),
    CONSTRAINT notification_delivery_attempts_status_check
        CHECK (status IN ('sent', 'failed', 'dead_letter')),
    CONSTRAINT notification_delivery_attempts_number_check
        CHECK (attempt_number > 0),
    CONSTRAINT notification_delivery_attempts_http_status_check
        CHECK (http_status IS NULL OR (http_status >= 100 AND http_status <= 599)),
    CONSTRAINT notification_delivery_attempts_window_check
        CHECK (completed_at >= started_at)
);

CREATE INDEX notification_delivery_attempts_notification_idx
    ON notification_delivery_attempts (notification_id, attempt_number DESC);

CREATE INDEX notification_delivery_attempts_status_created_idx
    ON notification_delivery_attempts (status, created_at DESC);
