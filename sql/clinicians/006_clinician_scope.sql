-- sql/clinicians/006_clinician_scope.sql
-- Module 3 — Tab 9: Scope of Practice
--
-- Stores per-clinician detailed scope data:
--   - Workstreams (trained + actively using)
--   - Systems in use
--   - Shadowing availability
--
-- The flat arrays (scope_workstreams, systems_in_use) are ALSO denormalised
-- on the clinicians table (001_create_clinicians.sql) for fast rota lookups.
-- This table holds the richer detail + change history via updated_at.

CREATE TABLE IF NOT EXISTS clinician_scope_of_practice (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinician_id        UUID NOT NULL REFERENCES clinicians(id) ON DELETE CASCADE,

  -- Workstreams: stored as JSONB array
  -- Each item: { name, trained, activelyUsing, notes }
  workstreams         JSONB NOT NULL DEFAULT '[]',

  -- Systems in use: JSONB array
  -- Each item: { name, proficiencyLevel }  (basic | proficient | expert)
  systems_in_use      JSONB NOT NULL DEFAULT '[]',

  -- Shadowing
  shadowing_available BOOLEAN NOT NULL DEFAULT FALSE,
  shadowing_notes     TEXT    NOT NULL DEFAULT '',

  -- General notes
  notes               TEXT    NOT NULL DEFAULT '',

  -- Audit
  updated_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only one scope record per clinician
CREATE UNIQUE INDEX IF NOT EXISTS uq_clinician_scope
  ON clinician_scope_of_practice (clinician_id);

-- Fast lookup by clinician
CREATE INDEX IF NOT EXISTS idx_scope_clinician
  ON clinician_scope_of_practice (clinician_id);

-- Trigger: keep updated_at current
CREATE OR REPLACE FUNCTION set_scope_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_scope_updated_at ON clinician_scope_of_practice;
CREATE TRIGGER trg_scope_updated_at
  BEFORE UPDATE ON clinician_scope_of_practice
  FOR EACH ROW EXECUTE FUNCTION set_scope_updated_at();

-- Back-fill denormalised columns on clinicians if they don't exist yet
-- (safe to run repeatedly — uses IF NOT EXISTS pattern)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='clinicians' AND column_name='scope_workstreams'
  ) THEN
    ALTER TABLE clinicians ADD COLUMN scope_workstreams JSONB NOT NULL DEFAULT '[]';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='clinicians' AND column_name='systems_in_use'
  ) THEN
    ALTER TABLE clinicians ADD COLUMN systems_in_use JSONB NOT NULL DEFAULT '[]';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='clinicians' AND column_name='shadowing_available'
  ) THEN
    ALTER TABLE clinicians ADD COLUMN shadowing_available BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END;
$$;