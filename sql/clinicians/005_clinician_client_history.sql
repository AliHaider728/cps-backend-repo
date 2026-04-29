-- 005_clinician_client_history.sql                      Module 3
-- Reference SQL — runtime uses ClinicianClientHistory model in app_records.

CREATE TABLE IF NOT EXISTS clinician_client_history (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  clinician_id    UUID         REFERENCES clinicians(id) ON DELETE CASCADE,
  pcn_id          UUID         REFERENCES pcns(id),
  practice_id     UUID         REFERENCES practices(id),
  contract        TEXT         CHECK (contract IN ('ARRS','EA','Direct')),
  start_date      DATE,
  end_date        DATE,
  status          TEXT         DEFAULT 'active'
                  CHECK (status IN ('active','ended','restricted')),
  system_access   JSONB        DEFAULT '[]'::jsonb,
  is_restricted   BOOLEAN      DEFAULT false,
  restrict_reason TEXT,
  created_by      UUID         REFERENCES users(id),
  created_at      TIMESTAMPTZ  DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cch_clinician ON clinician_client_history(clinician_id);
CREATE INDEX IF NOT EXISTS idx_cch_pcn       ON clinician_client_history(pcn_id);
CREATE INDEX IF NOT EXISTS idx_cch_practice  ON clinician_client_history(practice_id);
CREATE INDEX IF NOT EXISTS idx_cch_status    ON clinician_client_history(status);
