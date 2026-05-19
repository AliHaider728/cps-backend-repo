CREATE TABLE IF NOT EXISTS surgeries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  pcn_id UUID REFERENCES pcns(id),
  address TEXT,
  service_type VARCHAR(20) CHECK (service_type IN ('PCN','GP','EA')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS base_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinician_id UUID NOT NULL REFERENCES clinicians(id) ON DELETE CASCADE,
  surgery_id UUID NOT NULL REFERENCES surgeries(id),
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  expected_hours DECIMAL(4,2) NOT NULL,
  contract_type VARCHAR(20) CHECK (contract_type IN ('ARRS','EA','Direct')),
  is_active BOOLEAN DEFAULT true,
  effective_from DATE NOT NULL,
  effective_to DATE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_base_patterns_clinician ON base_patterns(clinician_id, is_active);
CREATE INDEX IF NOT EXISTS idx_base_patterns_surgery ON base_patterns(surgery_id, is_active);
