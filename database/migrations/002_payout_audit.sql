ALTER TABLE payout_slots
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE payout_slots
  ADD COLUMN IF NOT EXISTS recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS payout_slots_group_cycle_idx ON payout_slots (group_id, status, position);
CREATE INDEX IF NOT EXISTS activity_group_created_idx ON activity (group_id, created_at DESC);
