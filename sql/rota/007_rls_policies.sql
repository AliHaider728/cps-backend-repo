ALTER TABLE timesheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE timesheet_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE rota_shifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clinician_own_timesheet ON timesheets;
CREATE POLICY clinician_own_timesheet ON timesheets
  FOR ALL USING (
    auth.uid() = clinician_id
    OR EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid()
      AND role IN ('super_admin','ops_manager','finance','director')
    )
  );

DROP POLICY IF EXISTS clinician_own_entries ON timesheet_entries;
CREATE POLICY clinician_own_entries ON timesheet_entries
  FOR ALL USING (
    auth.uid() = clinician_id
    OR EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid()
      AND role IN ('super_admin','ops_manager','finance','director')
    )
  );

DROP POLICY IF EXISTS rota_shift_access ON rota_shifts;
CREATE POLICY rota_shift_access ON rota_shifts
  FOR SELECT USING (
    auth.uid() = clinician_id
    OR EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid()
      AND role IN ('super_admin','ops_manager','finance','director')
    )
  );
