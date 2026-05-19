CREATE TABLE IF NOT EXISTS timesheet_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timesheet_id UUID NOT NULL REFERENCES timesheets(id) ON DELETE CASCADE,
  clinician_id UUID NOT NULL REFERENCES clinicians(id),
  surgery_id UUID NOT NULL REFERENCES surgeries(id),
  shift_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  actual_hours DECIMAL(4,2),
  expected_hours DECIMAL(4,2),
  is_cover BOOLEAN DEFAULT false,
  project_code VARCHAR(50),
  service_code VARCHAR(20) CHECK (service_code IN ('PCN','GP','EA')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_timesheet_entries_timesheet ON timesheet_entries(timesheet_id);
CREATE INDEX IF NOT EXISTS idx_timesheet_entries_clinician_date ON timesheet_entries(clinician_id, shift_date);
CREATE UNIQUE INDEX IF NOT EXISTS uq_timesheet_entry_shift
  ON timesheet_entries(timesheet_id, clinician_id, surgery_id, shift_date);
