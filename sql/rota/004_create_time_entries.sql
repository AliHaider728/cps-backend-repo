-- =============================================================================
-- sql/rota/004_create_time_entries.sql
-- Clinician Clock-In / Clock-Out tracking (Rota Module — Spec §2.5)
-- Run this in Supabase SQL editor to create the table.
-- =============================================================================

CREATE TABLE IF NOT EXISTS time_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  clinician_id    TEXT        NOT NULL,   -- same TEXT type as shifts.clinician_id
  shift_id        UUID        REFERENCES shifts(id) ON DELETE SET NULL,

  clock_in        TIMESTAMPTZ NOT NULL DEFAULT now(),
  clock_out       TIMESTAMPTZ,
  actual_hours    NUMERIC(6,2),           -- auto-calculated on clock-out
  status          VARCHAR(20) NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','completed')),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one active entry per clinician at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_time_entries_one_active
  ON time_entries(clinician_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_time_entries_clinician
  ON time_entries(clinician_id);

CREATE INDEX IF NOT EXISTS idx_time_entries_shift
  ON time_entries(shift_id);
