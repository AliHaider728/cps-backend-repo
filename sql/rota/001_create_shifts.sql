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

-- =============================================================================
-- CPS monthly rota + timesheet workflow
-- =============================================================================

CREATE TABLE IF NOT EXISTS base_patterns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinician_id    UUID NOT NULL REFERENCES clinicians(id) ON DELETE CASCADE,
  surgery_id      UUID NOT NULL REFERENCES practices(id),
  day_of_week     INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time      TIME NOT NULL,
  end_time        TIME NOT NULL,
  expected_hours  DECIMAL(4,2) NOT NULL,
  contract_type   VARCHAR(20) CHECK (contract_type IN ('ARRS','EA','Direct')),
  is_active       BOOLEAN DEFAULT true,
  effective_from  DATE NOT NULL,
  effective_to    DATE,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rota_shifts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinician_id    UUID NOT NULL REFERENCES clinicians(id) ON DELETE CASCADE,
  surgery_id      UUID REFERENCES practices(id),
  shift_date      DATE NOT NULL,
  shift_type      VARCHAR(20) NOT NULL DEFAULT 'working'
                  CHECK (shift_type IN ('working','annual_leave','sick','cppe_training','cover','bank_holiday')),
  start_time      TIME,
  end_time        TIME,
  expected_hours  DECIMAL(4,2),
  is_filled       BOOLEAN DEFAULT false,
  is_cover        BOOLEAN DEFAULT false,
  cover_for       UUID REFERENCES clinicians(id),
  rota_month      INTEGER NOT NULL,
  rota_year       INTEGER NOT NULL,
  sent_to_client  BOOLEAN DEFAULT false,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS timesheets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinician_id     UUID NOT NULL REFERENCES clinicians(id),
  month            INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  year             INTEGER NOT NULL,
  status           VARCHAR(20) DEFAULT 'draft'
                   CHECK (status IN ('draft','submitted','approved','rejected')),
  submitted_at     TIMESTAMPTZ,
  approved_at      TIMESTAMPTZ,
  approved_by      UUID REFERENCES users(id),
  rejected_at      TIMESTAMPTZ,
  rejected_by      UUID REFERENCES users(id),
  rejection_reason TEXT,
  total_hours      DECIMAL(6,2) DEFAULT 0,
  invoice_sent     BOOLEAN DEFAULT false,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE(clinician_id, month, year)
);

CREATE TABLE IF NOT EXISTS timesheet_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timesheet_id    UUID NOT NULL REFERENCES timesheets(id) ON DELETE CASCADE,
  clinician_id    UUID NOT NULL REFERENCES clinicians(id),
  surgery_id      UUID REFERENCES practices(id),
  shift_date      DATE NOT NULL,
  start_time      TIME,
  end_time        TIME,
  actual_hours    DECIMAL(4,2),
  expected_hours  DECIMAL(4,2),
  is_cover        BOOLEAN DEFAULT false,
  project_code    VARCHAR(50),
  service_code    VARCHAR(20) CHECK (service_code IN ('PCN','GP','EA')),
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cover_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rota_shift_id   UUID REFERENCES rota_shifts(id),
  surgery_id      UUID NOT NULL REFERENCES practices(id),
  shift_date      DATE NOT NULL,
  shift_start     TIME,
  shift_end       TIME,
  required_skills TEXT[],
  service_code    VARCHAR(20) CHECK (service_code IN ('PCN','GP','EA')),
  project_code    VARCHAR(50) DEFAULT 'COVER',
  status          VARCHAR(20) DEFAULT 'open'
                  CHECK (status IN ('open','assigned','filled','cancelled')),
  assigned_to     UUID REFERENCES clinicians(id),
  assigned_by     UUID REFERENCES users(id),
  assigned_at     TIMESTAMPTZ,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rota_shifts_unique_working
  ON rota_shifts(clinician_id, surgery_id, shift_date, shift_type);
CREATE INDEX IF NOT EXISTS idx_rota_shifts_month_year ON rota_shifts(rota_year, rota_month);
CREATE INDEX IF NOT EXISTS idx_rota_shifts_gap ON rota_shifts(is_filled, shift_type, shift_date);
CREATE INDEX IF NOT EXISTS idx_base_patterns_active ON base_patterns(is_active, day_of_week);
CREATE INDEX IF NOT EXISTS idx_timesheets_status ON timesheets(status);
CREATE INDEX IF NOT EXISTS idx_timesheet_entries_timesheet ON timesheet_entries(timesheet_id);
CREATE INDEX IF NOT EXISTS idx_cover_requests_status_date ON cover_requests(status, shift_date);

ALTER TABLE timesheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE timesheet_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE rota_shifts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'timesheets' AND policyname = 'clinician_own_timesheet') THEN
    CREATE POLICY clinician_own_timesheet ON timesheets FOR ALL
      USING (auth.uid()::text = clinician_id::text
        OR EXISTS (SELECT 1 FROM users WHERE id::text = auth.uid()::text
                   AND role IN ('super_admin','ops_manager','finance','director','workforce')));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'timesheet_entries' AND policyname = 'clinician_own_entries') THEN
    CREATE POLICY clinician_own_entries ON timesheet_entries FOR ALL
      USING (auth.uid()::text = clinician_id::text
        OR EXISTS (SELECT 1 FROM users WHERE id::text = auth.uid()::text
                   AND role IN ('super_admin','ops_manager','finance','director','workforce')));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'rota_shifts' AND policyname = 'rota_access') THEN
    CREATE POLICY rota_access ON rota_shifts FOR SELECT
      USING (auth.uid()::text = clinician_id::text
        OR EXISTS (SELECT 1 FROM users WHERE id::text = auth.uid()::text
                   AND role IN ('super_admin','ops_manager','workforce','director','finance','training')));
  END IF;
END $$;
