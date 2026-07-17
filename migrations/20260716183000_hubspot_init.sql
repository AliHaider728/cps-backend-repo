-- Migration: HubSpot Init
-- Description: Creates the integration_sync_jobs and hubspot_record_mappings tables.

CREATE TABLE IF NOT EXISTS integration_sync_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead_letter')),
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_at TIMESTAMPTZ,
    locked_by TEXT,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_integration_sync_jobs_status_next_attempt 
    ON integration_sync_jobs(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS hubspot_record_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL DEFAULT 'hubspot',
    cps_entity_type TEXT NOT NULL,
    cps_entity_id TEXT NOT NULL,
    cps_parent_type TEXT,
    cps_parent_id TEXT,
    contact_bucket TEXT,
    hubspot_object_type TEXT NOT NULL,
    hubspot_object_id TEXT,
    external_key TEXT NOT NULL,
    sync_status TEXT,
    last_synced_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (provider, hubspot_object_type, external_key)
);

CREATE INDEX IF NOT EXISTS idx_hubspot_mappings_cps_entity 
    ON hubspot_record_mappings(cps_entity_type, cps_entity_id);

CREATE INDEX IF NOT EXISTS idx_hubspot_mappings_hubspot_object 
    ON hubspot_record_mappings(hubspot_object_type, hubspot_object_id);
