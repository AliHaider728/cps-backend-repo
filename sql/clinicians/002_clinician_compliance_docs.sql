-- 002_clinician_compliance_docs.sql                     Module 3
-- Reference SQL — runtime uses ClinicianComplianceDoc model in app_records.

CREATE TABLE IF NOT EXISTS clinician_compliance_docs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinician_id  UUID        REFERENCES clinicians(id) ON DELETE CASCADE,
  doc_name      TEXT        NOT NULL,
  doc_key       TEXT,
  status        TEXT        DEFAULT 'missing'
                CHECK (status IN ('missing','uploaded','approved','expired','rejected')),
  file_url      TEXT,
  file_name     TEXT,
  storage_path  TEXT,
  bucket        TEXT,
  expiry_date   DATE,
  mandatory     BOOLEAN     DEFAULT true,
  uploaded_by   TEXT        DEFAULT 'clinician',
  uploaded_at   TIMESTAMPTZ,
  approved_by   UUID        REFERENCES users(id),
  approved_at   TIMESTAMPTZ,
  rejected_by   UUID        REFERENCES users(id),
  rejected_at   TIMESTAMPTZ,
  reject_reason TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ccd_clinician ON clinician_compliance_docs(clinician_id);
CREATE INDEX IF NOT EXISTS idx_ccd_status    ON clinician_compliance_docs(status);
CREATE INDEX IF NOT EXISTS idx_ccd_expiry    ON clinician_compliance_docs(expiry_date);
