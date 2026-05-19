CREATE TABLE IF NOT EXISTS surgeries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  pcn_id UUID REFERENCES pcns(id),
  address TEXT,
  service_type VARCHAR(20) CHECK (service_type IN ('PCN','GP','EA')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_surgeries_pcn ON surgeries(pcn_id);
CREATE INDEX IF NOT EXISTS idx_surgeries_active ON surgeries(is_active);
