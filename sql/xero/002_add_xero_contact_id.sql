-- =============================================================================
-- sql/xero/002_add_xero_contact_id.sql
-- =============================================================================

ALTER TABLE practices ADD COLUMN IF NOT EXISTS xero_contact_id TEXT;
ALTER TABLE pcns ADD COLUMN IF NOT EXISTS xero_contact_id TEXT;
