ALTER TABLE disaster_events
    ADD COLUMN alert_level TEXT;

ALTER TABLE disaster_events
    ADD CONSTRAINT disaster_events_alert_level_check
    CHECK (alert_level IS NULL OR alert_level IN ('green', 'orange', 'red'));

UPDATE source_catalogue
SET
    updated_at = NOW(),
    metadata = metadata
        || jsonb_build_object(
            'alert_level_semantics',
            'GDACS alertlevel is persisted as green/orange/red when present; missing values remain NULL and are mapped to low severity only for dashboard compatibility.'
        )
WHERE source_id = 'gdacs-disasters';
