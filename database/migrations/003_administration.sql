CREATE TABLE IF NOT EXISTS saccos (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS saccos_name_lower_unique
  ON saccos (LOWER(name));

CREATE TABLE IF NOT EXISTS sacco_administrators (
  sacco_id INTEGER NOT NULL REFERENCES saccos(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (sacco_id, user_id)
);
CREATE INDEX IF NOT EXISTS sacco_administrators_user_idx ON sacco_administrators (user_id);

ALTER TABLE chama_groups
  ADD COLUMN IF NOT EXISTS sacco_id INTEGER REFERENCES saccos(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS chama_groups_sacco_id_idx ON chama_groups (sacco_id);

CREATE TABLE IF NOT EXISTS administration_audit (
  id BIGSERIAL PRIMARY KEY,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  sacco_id INTEGER REFERENCES saccos(id) ON DELETE SET NULL,
  action VARCHAR(48) NOT NULL,
  target_type VARCHAR(24) NOT NULL,
  target_id VARCHAR(64),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS administration_audit_sacco_created_idx
  ON administration_audit (sacco_id, created_at DESC);
