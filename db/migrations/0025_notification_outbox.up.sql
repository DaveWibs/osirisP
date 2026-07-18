CREATE TABLE notification_subscriptions (
    id UUID PRIMARY KEY,
    subscription_key TEXT NOT NULL UNIQUE,
    adapter TEXT NOT NULL,
    destination_ref TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    min_severity TEXT NOT NULL DEFAULT 'warning',
    topics TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT notification_subscriptions_adapter_check
        CHECK (adapter IN ('telegram')),
    CONSTRAINT notification_subscriptions_destination_ref_check
        CHECK (LENGTH(BTRIM(destination_ref)) > 0),
    CONSTRAINT notification_subscriptions_min_severity_check
        CHECK (min_severity IN ('info', 'warning', 'critical'))
);

CREATE INDEX notification_subscriptions_enabled_idx
    ON notification_subscriptions (enabled, adapter);

CREATE TABLE notification_outbox (
    id UUID PRIMARY KEY,
    outbox_key TEXT NOT NULL UNIQUE,
    dedupe_key TEXT NOT NULL UNIQUE,
    alert_id UUID NOT NULL REFERENCES intelligence_alerts(id) ON DELETE CASCADE,
    subscription_id UUID NOT NULL REFERENCES notification_subscriptions(id) ON DELETE CASCADE,
    adapter TEXT NOT NULL,
    destination_ref TEXT NOT NULL,
    topic TEXT NOT NULL,
    severity TEXT NOT NULL,
    status TEXT NOT NULL,
    payload JSONB NOT NULL,
    available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    last_error JSONB,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT notification_outbox_adapter_check
        CHECK (adapter IN ('telegram')),
    CONSTRAINT notification_outbox_destination_ref_check
        CHECK (LENGTH(BTRIM(destination_ref)) > 0),
    CONSTRAINT notification_outbox_topic_check
        CHECK (LENGTH(BTRIM(topic)) > 0),
    CONSTRAINT notification_outbox_severity_check
        CHECK (severity IN ('info', 'warning', 'critical')),
    CONSTRAINT notification_outbox_status_check
        CHECK (status IN ('pending', 'delivering', 'sent', 'failed', 'dead_letter', 'cancelled')),
    CONSTRAINT notification_outbox_attempts_check
        CHECK (attempt_count >= 0 AND max_attempts > 0 AND attempt_count <= max_attempts),
    CONSTRAINT notification_outbox_sent_state_check
        CHECK (sent_at IS NULL OR status = 'sent'),
    CONSTRAINT notification_outbox_failure_state_check
        CHECK (failed_at IS NULL OR status IN ('failed', 'dead_letter'))
);

CREATE INDEX notification_outbox_status_available_idx
    ON notification_outbox (status, available_at ASC, created_at ASC);

CREATE INDEX notification_outbox_alert_idx
    ON notification_outbox (alert_id, status);

CREATE INDEX notification_outbox_subscription_idx
    ON notification_outbox (subscription_id, status, created_at DESC);
