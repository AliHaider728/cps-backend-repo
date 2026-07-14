-- =============================================================================
-- sql/xero/003_create_audit_log.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS xero_audit_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      TEXT,
  action_type    TEXT NOT NULL,
  title          TEXT NOT NULL,
  description    TEXT,
  status         TEXT NOT NULL,
  performed_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT now()
);
