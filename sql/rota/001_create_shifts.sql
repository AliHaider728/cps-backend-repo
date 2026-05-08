-- =============================================================================
-- sql/rota/001_create_shifts.sql  — UPDATED VERSION
-- Changes: practice_id, client_id, clinician_id → TEXT (was UUID)
-- Reason: ODS codes like "P84001", Xero codes, and Mongo ObjectId strings
--         are not UUIDs — using UUID caused "invalid input syntax for type uuid"
-- =============================================================================

CREATE TABLE IF NOT EXISTS shifts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ⚠ TEXT (not UUID): accepts ODS codes (P84001), Xero codes, Mongo ObjectIds
  clinician_id  TEXT,
  practice_id   TEXT NOT NULL,
  client_id     TEXT,

  date          DATE        NOT NULL,
  day_of_week   VARCHAR(10),
  start_time    TIME,
  end_time      TIME,
  hours         NUMERIC(4,2),
  clinical_system VARCHAR(20),
  status        VARCHAR(20) NOT NULL CHECK (status IN (
    'working','annual_leave','sick','cppe','cover','gap','cancelled'
  )),

  -- Cover fields
  is_cover      BOOLEAN DEFAULT false,
  project_code  VARCHAR(10),
  service_code  VARCHAR(10),
  original_gap_id UUID REFERENCES shifts(id) ON DELETE SET NULL,
  cover_reason  TEXT,

  -- Tracking
  confirmation_received  BOOLEAN DEFAULT false,
  access_request_needed  BOOLEAN DEFAULT false,
  client_informed        BOOLEAN DEFAULT false,
  workstreams_notes      TEXT,
  clinician_notified     BOOLEAN DEFAULT false,
  hours_to_cover         NUMERIC(4,2),
  hours_covered          NUMERIC(4,2),

  -- Compliance
  compliance_checked         BOOLEAN DEFAULT false,
  compliance_override_by     UUID REFERENCES users(id),
  compliance_override_reason TEXT,

  -- Source
  source          VARCHAR(20) CHECK (source IN (
    'manual','leave_approval','sick_log','cppe_approval','auto_generated'
  )),
  source_leave_id UUID,

  -- Audit
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_shifts_date_practice  ON shifts(date, practice_id);
CREATE INDEX IF NOT EXISTS idx_shifts_clinician_date ON shifts(clinician_id, date);
CREATE INDEX IF NOT EXISTS idx_shifts_status_date    ON shifts(status, date);

-- ── Cover Requests ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cover_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id     UUID REFERENCES shifts(id) ON DELETE CASCADE,
  practice_id  TEXT NOT NULL,          -- TEXT: ODS codes accepted
  practice_name VARCHAR(255),
  date         DATE         NOT NULL,
  start_time   TIME,
  end_time     TIME,
  hours_needed NUMERIC(4,2),
  clinical_system VARCHAR(20),
  status       VARCHAR(20)  DEFAULT 'open' CHECK (status IN ('open','filled','cancelled')),
  filled_by    TEXT,                   -- TEXT: Mongo ObjectId or UUID
  email_sent_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ  DEFAULT now()
);

-- ── Rota Distributions ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rota_distributions (
  id           UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    TEXT     NOT NULL,     -- TEXT: Xero code or UUID
  client_name  VARCHAR(255),
  month        INTEGER  NOT NULL CHECK (month BETWEEN 1 AND 12),
  year         INTEGER  NOT NULL CHECK (year  BETWEEN 2020 AND 2100),
  sent_by      UUID     REFERENCES users(id),
  sent_at      TIMESTAMPTZ DEFAULT now(),
  recipient_emails TEXT[]
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rota_dist_unique
  ON rota_distributions(client_id, month, year);