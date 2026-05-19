CREATE TABLE IF NOT EXISTS cover_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rota_shift_id UUID REFERENCES rota_shifts(id),
  surgery_id UUID NOT NULL REFERENCES surgeries(id),
  shift_date DATE NOT NULL,
  shift_start TIME,
  shift_end TIME,
  required_skills TEXT[],
  service_code VARCHAR(20) CHECK (service_code IN ('PCN','GP','EA')),
  project_code VARCHAR(50) DEFAULT 'COVER',
  status VARCHAR(20) DEFAULT 'open'
    CHECK (status IN ('open','assigned','filled','cancelled')),
  assigned_to UUID REFERENCES clinicians(id),
  assigned_by UUID REFERENCES users(id),
  assigned_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cover_requests_status_date ON cover_requests(status, shift_date);
CREATE INDEX IF NOT EXISTS idx_cover_requests_surgery ON cover_requests(surgery_id, status);
