-- sql/rota/008_add_timesheets_created_by.sql
-- Fix: seed.js Module 6 and Supabase client inserts expect timesheets.created_by
-- Error: Could not find the 'created_by' column of 'timesheets' in the schema cache

ALTER TABLE timesheets
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_timesheets_created_by ON timesheets(created_by);

COMMENT ON COLUMN timesheets.created_by IS 'User who created or auto-generated this timesheet record';
