ALTER TABLE members
  ADD COLUMN IF NOT EXISTS registration_number VARCHAR(32),
  ADD COLUMN IF NOT EXISTS phone_number VARCHAR(24),
  ADD COLUMN IF NOT EXISTS location VARCHAR(120),
  ADD COLUMN IF NOT EXISTS contact_email VARCHAR(254);

CREATE UNIQUE INDEX IF NOT EXISTS members_group_registration_number_unique
  ON members (group_id, LOWER(registration_number))
  WHERE registration_number IS NOT NULL AND registration_number <> '';
