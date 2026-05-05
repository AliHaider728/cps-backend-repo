CREATE TABLE shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinician_id UUID REFERENCES clinicians(id) ON DELETE SET NULL,
  practice_id UUID NOT NULL,
  client_id UUID,
  date DATE NOT NULL,
  day_of_week VARCHAR(10),
  start_time TIME,
  end_time TIME,
  hours NUMERIC(4,2),
  clinical_system VARCHAR(20),
  status VARCHAR(20) NOT NULL CHECK (status IN (
    'working','annual_leave','sick','cppe','cover','gap','cancelled'
  )),

  is_cover BOOLEAN DEFAULT false,
  project_code VARCHAR(10),
  service_code VARCHAR(10),
  original_gap_id UUID REFERENCES shifts(id) ON DELETE SET NULL,
  cover_reason TEXT,

  confirmation_received BOOLEAN DEFAULT false,
  access_request_needed BOOLEAN DEFAULT false,
  client_informed BOOLEAN DEFAULT false,
  workstreams_notes TEXT,
  clinician_notified BOOLEAN DEFAULT false,
  hours_to_cover NUMERIC(4,2),
  hours_covered NUMERIC(4,2),

  compliance_checked BOOLEAN DEFAULT false,
  compliance_override_by UUID REFERENCES users(id),
  compliance_override_reason TEXT,

  source VARCHAR(20) CHECK (source IN (
    'manual','leave_approval','sick_log','cppe_approval','auto_generated'
  )),
  source_leave_id UUID,

  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_shifts_date_practice  ON shifts(date, practice_id);
CREATE INDEX idx_shifts_clinician_date ON shifts(clinician_id, date);
CREATE INDEX idx_shifts_status_date    ON shifts(status, date);

CREATE TABLE cover_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id UUID REFERENCES shifts(id) ON DELETE CASCADE,
  practice_id UUID NOT NULL,
  practice_name VARCHAR(255),
  date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  hours_needed NUMERIC(4,2),
  clinical_system VARCHAR(20),
  status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open','filled','cancelled')),
  filled_by UUID REFERENCES clinicians(id) ON DELETE SET NULL,
  email_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE rota_distributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL,
  client_name VARCHAR(255),
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  year INTEGER NOT NULL CHECK (year BETWEEN 2020 AND 2100),
  sent_by UUID REFERENCES users(id),
  sent_at TIMESTAMPTZ DEFAULT now(),
  recipient_emails TEXT[]
);

CREATE UNIQUE INDEX idx_rota_dist_unique ON rota_distributions(client_id, month, year);
