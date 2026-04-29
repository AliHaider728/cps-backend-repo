-- ────────────────────────────────────────────────────────────────────
-- 001_create_clinicians.sql                              Module 3
-- ────────────────────────────────────────────────────────────────────
-- Reference SQL schema for the Clinician table.
--
-- NOTE: This project's runtime stores all records as JSONB rows in the
-- shared `app_records` table (see backend/lib/model.js). The active
-- Clinician model lives at backend/models/Clinician.js.
--
-- This SQL file is provided for documentation and as a future
-- migration target if the team chooses to denormalise into a
-- dedicated table.
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS clinicians (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        REFERENCES users(id),
  full_name           TEXT,
  clinician_type      TEXT        CHECK (clinician_type IN ('Pharmacist','Technician','IP')),
  gphc_number         TEXT,
  smart_card          TEXT,
  phone               TEXT,
  email               TEXT,
  address_line1       TEXT,
  address_line2       TEXT,
  city                TEXT,
  postcode            TEXT,
  emergency_contacts  JSONB       DEFAULT '[]'::jsonb,

  contract_type       TEXT        CHECK (contract_type IN ('ARRS','EA','Direct','Mixed')),
  notice_period       TEXT,
  working_hours       NUMERIC(5,2) DEFAULT 0,
  start_date          DATE,
  end_date            DATE,

  ops_lead_id         UUID        REFERENCES users(id),
  supervisor_id       UUID        REFERENCES users(id),

  specialisms         TEXT[]      DEFAULT '{}',
  future_potential    TEXT,
  scope_workstreams   TEXT[]      DEFAULT '{}',
  shadowing_available BOOLEAN     DEFAULT false,
  systems_in_use      TEXT[]      DEFAULT '{}',

  onboarding          JSONB       DEFAULT '{}'::jsonb,
  cppe_status         JSONB       DEFAULT '{}'::jsonb,

  is_restricted       BOOLEAN     DEFAULT false,
  restrict_reason     TEXT,
  is_active           BOOLEAN     DEFAULT true,

  notes               TEXT,
  created_by          UUID        REFERENCES users(id),
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clinicians_user        ON clinicians(user_id);
CREATE INDEX IF NOT EXISTS idx_clinicians_ops_lead    ON clinicians(ops_lead_id);
CREATE INDEX IF NOT EXISTS idx_clinicians_supervisor  ON clinicians(supervisor_id);
CREATE INDEX IF NOT EXISTS idx_clinicians_active      ON clinicians(is_active);
CREATE INDEX IF NOT EXISTS idx_clinicians_restricted  ON clinicians(is_restricted);
