CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  full_name VARCHAR(100) NOT NULL,
  email VARCHAR(254) NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique ON users (LOWER(email));

CREATE TABLE IF NOT EXISTS chama_groups (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  contribution_amount DECIMAL(12, 2) NOT NULL CHECK (contribution_amount > 0),
  cycle_number INTEGER NOT NULL DEFAULT 1 CHECK (cycle_number > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS members (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES chama_groups(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'Member',
  trust_score SMALLINT NOT NULL DEFAULT 70 CHECK (trust_score BETWEEN 0 AND 100),
  paid_this_cycle BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payout_slots (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES chama_groups(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position > 0),
  payout_date DATE NOT NULL,
  amount DECIMAL(12, 2) NOT NULL CHECK (amount > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'upcoming',
  is_listed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (group_id, position)
);

CREATE TABLE IF NOT EXISTS activity (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES chama_groups(id) ON DELETE CASCADE,
  member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('contribution', 'payout')),
  description VARCHAR(180) NOT NULL,
  amount DECIMAL(12, 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE chama_groups
  ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE chama_groups
  ADD COLUMN IF NOT EXISTS frequency VARCHAR(10) NOT NULL DEFAULT 'monthly';
ALTER TABLE chama_groups
  ADD COLUMN IF NOT EXISTS start_date DATE NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE chama_groups
  ADD COLUMN IF NOT EXISTS status VARCHAR(12) NOT NULL DEFAULT 'active';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chama_groups_frequency_check') THEN
    ALTER TABLE chama_groups
      ADD CONSTRAINT chama_groups_frequency_check CHECK (frequency IN ('weekly', 'biweekly', 'monthly'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chama_groups_status_check') THEN
    ALTER TABLE chama_groups
      ADD CONSTRAINT chama_groups_status_check CHECK (status IN ('active', 'completed', 'archived'));
  END IF;
END $$;

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS trust_score SMALLINT NOT NULL DEFAULT 70;

CREATE UNIQUE INDEX IF NOT EXISTS members_group_user_unique
  ON members (group_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS members_user_id_idx ON members (user_id);
CREATE INDEX IF NOT EXISTS members_group_id_idx ON members (group_id);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions (expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS contributions (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES chama_groups(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  period_number INTEGER NOT NULL CHECK (period_number > 0),
  amount DECIMAL(12, 2) NOT NULL CHECK (amount > 0),
  due_date DATE NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'late', 'waived')),
  payment_method VARCHAR(16) NOT NULL DEFAULT 'manual'
    CHECK (payment_method IN ('manual', 'simulated')),
  paid_at TIMESTAMPTZ,
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (member_id, period_number)
);
CREATE INDEX IF NOT EXISTS contributions_group_due_idx ON contributions (group_id, due_date);
CREATE INDEX IF NOT EXISTS contributions_member_idx ON contributions (member_id, period_number);

CREATE TABLE IF NOT EXISTS slot_listings (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES chama_groups(id) ON DELETE CASCADE,
  slot_id INTEGER NOT NULL REFERENCES payout_slots(id) ON DELETE CASCADE,
  listed_by INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  discount_amount DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  status VARCHAR(12) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS slot_listings_one_open_per_slot
  ON slot_listings (slot_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS slot_listings_group_status_idx ON slot_listings (group_id, status);

CREATE TABLE IF NOT EXISTS slot_listing_interests (
  id SERIAL PRIMARY KEY,
  listing_id INTEGER NOT NULL REFERENCES slot_listings(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  message VARCHAR(300),
  status VARCHAR(12) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'withdrawn')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (listing_id, member_id)
);
CREATE INDEX IF NOT EXISTS slot_interests_member_idx ON slot_listing_interests (member_id, status);
