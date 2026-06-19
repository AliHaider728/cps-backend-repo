-- =============================================================================
-- sql/rota/003_pcn_replace_annual_spend.sql
--
-- PCN table: remove annual_spend, add hourly_rate + contract_start_date
--
-- NOTE: 002_add_hourly_rate_total_value.sql was for the SHIFTS table.
--       This file is specifically for the PCN table.
--
-- Run AFTER any existing migrations.
-- =============================================================================

-- Drop old column
ALTER TABLE pcns
  DROP COLUMN IF EXISTS annual_spend;

-- Add new columns
ALTER TABLE pcns
  ADD COLUMN IF NOT EXISTS hourly_rate         NUMERIC(8,2)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS contract_start_date DATE          DEFAULT NULL;

-- Optional indexes for finance/reporting queries
CREATE INDEX IF NOT EXISTS idx_pcns_hourly_rate
  ON pcns(hourly_rate)
  WHERE hourly_rate IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pcns_contract_start_date
  ON pcns(contract_start_date)
  WHERE contract_start_date IS NOT NULL;

-- Column comments
COMMENT ON COLUMN pcns.hourly_rate         IS 'Clinician hourly rate (£) for this PCN contract — replaces annual_spend';
COMMENT ON COLUMN pcns.contract_start_date IS 'Date the PCN contract started';p