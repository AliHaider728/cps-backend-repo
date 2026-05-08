-- =============================================================================
-- sql/rota/003_fix_created_by_fk.sql
-- Fix: created_by, compliance_override_by foreign key violations
-- Reason: Users are stored in app_records (TEXT ids), not in users table
-- Run this to drop the broken FK constraints and change columns to TEXT
-- =============================================================================

-- Drop FK constraints that reference users(id)
ALTER TABLE shifts
  DROP CONSTRAINT IF EXISTS shifts_created_by_fkey,
  DROP CONSTRAINT IF EXISTS shifts_compliance_override_by_fkey;

-- Change column types from UUID to TEXT
ALTER TABLE shifts
  ALTER COLUMN created_by TYPE TEXT,
  ALTER COLUMN compliance_override_by TYPE TEXT;

-- Fix rota_distributions table too (same issue)
ALTER TABLE rota_distributions
  DROP CONSTRAINT IF EXISTS rota_distributions_sent_by_fkey;

ALTER TABLE rota_distributions
  ALTER COLUMN sent_by TYPE TEXT;

-- Rebuild index on created_by for audit queries
DROP INDEX IF EXISTS idx_shifts_created_by;
CREATE INDEX IF NOT EXISTS idx_shifts_created_by ON shifts(created_by);