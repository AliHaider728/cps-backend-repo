-- 004_clinician_supervision.sql                         Module 3
-- Reference SQL — runtime uses ClinicianSupervisionLog model in app_records.

CREATE TABLE IF NOT EXISTS clinician_supervision_logs (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  clinician_id  UUID         REFERENCES clinicians(id) ON DELETE CASCADE,
  session_date  DATE         NOT NULL,
  rag_status    TEXT         CHECK (rag_status IN ('red','amber','green')),
  notes         TEXT,
  action_items  JSONB        DEFAULT '[]'::jsonb,
  supervisor_id UUID         REFERENCES users(id),
  created_by    UUID         REFERENCES users(id),
  created_at    TIMESTAMPTZ  DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_csl_clinician ON clinician_supervision_logs(clinician_id);
CREATE INDEX IF NOT EXISTS idx_csl_date      ON clinician_supervision_logs(session_date);
CREATE INDEX IF NOT EXISTS idx_csl_rag       ON clinician_supervision_logs(rag_status);
