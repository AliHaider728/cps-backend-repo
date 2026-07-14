-- =============================================================================
-- sql/xero/001_create_xero_connections.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS xero_connections (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      TEXT NOT NULL,
  tenant_name    TEXT,
  access_token   TEXT NOT NULL,
  refresh_token  TEXT NOT NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  connected_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  connected_at   TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);
