-- 003_clinician_leave.sql                               Module 3
-- Reference SQL — runtime uses ClinicianLeaveEntry model in app_records.

CREATE TABLE IF NOT EXISTS clinician_leave_entries (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  clinician_id UUID         REFERENCES clinicians(id) ON DELETE CASCADE,
  leave_type   TEXT         CHECK (leave_type IN ('annual','sick','cppe','other')),
  contract     TEXT         CHECK (contract IN ('ARRS','EA','Direct')),
  start_date   DATE         NOT NULL,
  end_date     DATE         NOT NULL,
  days         NUMERIC(4,1),
  approved     BOOLEAN      DEFAULT false,
  approved_by  UUID         REFERENCES users(id),
  approved_at  TIMESTAMPTZ,
  notes        TEXT,
  created_by   UUID         REFERENCES users(id),
  created_at   TIMESTAMPTZ  DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cle_clinician ON clinician_leave_entries(clinician_id);
CREATE INDEX IF NOT EXISTS idx_cle_type      ON clinician_leave_entries(leave_type);
CREATE INDEX IF NOT EXISTS idx_cle_dates     ON clinician_leave_entries(start_date, end_date);
