-- =============================================================================
-- sql/rota/002_add_hourly_rate_total_value.sql
-- Adds hourly_rate and total_value columns to shifts table.
-- Required by CPS Rota Spec: shifts.hourly_rate + shifts.total_value
-- Run AFTER 001_create_shifts.sql
-- =============================================================================

ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS hourly_rate  NUMERIC(8,2),   -- Clinician's rate for this shift (£)
  ADD COLUMN IF NOT EXISTS total_value  NUMERIC(10,2);  -- hours × hourly_rate (auto or stored)

-- Optional: add a generated column so total_value is always consistent
-- (comment out if you prefer to store it manually from app)
-- ALTER TABLE shifts
--   ADD COLUMN IF NOT EXISTS total_value NUMERIC(10,2)
--   GENERATED ALWAYS AS (COALESCE(hours, 0) * COALESCE(hourly_rate, 0)) STORED;

-- Index for finance queries (filter by rate, sum by period)
CREATE INDEX IF NOT EXISTS idx_shifts_clinician_rate
  ON shifts(clinician_id, hourly_rate)
  WHERE hourly_rate IS NOT NULL;

COMMENT ON COLUMN shifts.hourly_rate IS 'Clinician hourly pay rate (£) for this specific shift';
COMMENT ON COLUMN shifts.total_value IS 'Computed total: hours × hourly_rate. Stored for invoice generation.';