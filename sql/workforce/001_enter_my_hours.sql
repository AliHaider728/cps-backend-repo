-- Enter My Hours module (separate from timesheets)
-- PostgreSQL / Supabase reference schema

CREATE TABLE IF NOT EXISTS enter_my_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinician_id UUID NOT NULL,
  shift_id UUID NOT NULL,
  assigned_shift_ref TEXT NOT NULL,
  practice_id UUID,
  practice_name TEXT,
  pcn TEXT,
  date_worked DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  break_duration_minutes INTEGER NOT NULL DEFAULT 0,
  total_worked_hours NUMERIC(6,2) NOT NULL DEFAULT 0,
  notes TEXT,
  submission_status TEXT NOT NULL DEFAULT 'draft' CHECK (submission_status IN ('draft','submitted')),
  manager_approval_status TEXT NOT NULL DEFAULT 'pending' CHECK (manager_approval_status IN ('pending','approved','rejected')),
  rejection_reason TEXT,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_enter_my_hours_unique_shift_day
  ON enter_my_hours(clinician_id, shift_id, date_worked);

CREATE INDEX IF NOT EXISTS idx_enter_my_hours_month
  ON enter_my_hours(date_trunc('month', date_worked));

