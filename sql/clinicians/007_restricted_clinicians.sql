-- sql/clinicians/007_restricted_clinicians.sql
-- Module 3 — Tab 9 (Restricted/Unsuitable flag)
--
-- Per-CLIENT restriction records.
-- A row here = "clinician X CANNOT be placed at entity Y (practice/PCN/surgery)".
-- This is SEPARATE from the global is_restricted flag on the clinicians table
-- (which blocks a clinician across the entire system).
--
-- The rota + bookings engine queries this table to apply hard-block flags.

CREATE TABLE IF NOT EXISTS restricted_clinicians (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who is restricted
  clinician_id    UUID NOT NULL REFERENCES clinicians(id) ON DELETE CASCADE,

  -- Which client entity they're restricted from
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('practice', 'pcn', 'surgery')),
  entity_id       UUID NOT NULL,   -- FK to the relevant table (practice/pcn); enforced at app level

  -- Why
  reason          TEXT NOT NULL DEFAULT '',
  notes           TEXT NOT NULL DEFAULT '',

  -- Soft-delete fields (preserve audit trail)
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  added_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  added_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  removed_at      TIMESTAMPTZ,
  remove_reason   TEXT        NOT NULL DEFAULT '',

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prevent duplicate active restrictions for the same clinician+entity
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_restriction
  ON restricted_clinicians (clinician_id, entity_type, entity_id)
  WHERE is_active = TRUE;

-- Rota lookup: "which clinicians are blocked at this practice/pcn?"
CREATE INDEX IF NOT EXISTS idx_restricted_entity
  ON restricted_clinicians (entity_type, entity_id, is_active);

-- Detail page lookup: "which clients is this clinician blocked from?"
CREATE INDEX IF NOT EXISTS idx_restricted_clinician
  ON restricted_clinicians (clinician_id, is_active);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_restricted_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_restricted_updated_at ON restricted_clinicians;
CREATE TRIGGER trg_restricted_updated_at
  BEFORE UPDATE ON restricted_clinicians
  FOR EACH ROW EXECUTE FUNCTION set_restricted_updated_at();

-- Helpful view for the rota engine: active restrictions with clinician info
CREATE OR REPLACE VIEW v_rota_blocked_clinicians AS
SELECT
  rc.entity_type,
  rc.entity_id,
  rc.clinician_id,
  c.full_name       AS clinician_name,
  c.clinician_type,
  rc.reason,
  rc.added_at
FROM restricted_clinicians rc
JOIN clinicians c ON c.id = rc.clinician_id
WHERE rc.is_active = TRUE;