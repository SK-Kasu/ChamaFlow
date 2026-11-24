CREATE TABLE IF NOT EXISTS group_join_requests (
  id BIGSERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES chama_groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(12) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  message VARCHAR(300) NOT NULL DEFAULT '',
  review_note VARCHAR(300),
  target_member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
  effective_cycle INTEGER CHECK (effective_cycle IS NULL OR effective_cycle > 0),
  applied_at TIMESTAMPTZ,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (group_id, user_id),
  CHECK (
    (status = 'approved' AND target_member_id IS NOT NULL AND effective_cycle IS NOT NULL)
    OR (status <> 'approved' AND target_member_id IS NULL AND effective_cycle IS NULL AND applied_at IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS group_join_requests_pending_member_unique
  ON group_join_requests (group_id, target_member_id)
  WHERE status = 'approved' AND applied_at IS NULL AND target_member_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS group_join_requests_pending_group_idx
  ON group_join_requests (group_id, requested_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS group_join_requests_user_requested_idx
  ON group_join_requests (user_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS chama_groups_active_directory_name_idx
  ON chama_groups (LOWER(name), id)
  WHERE status = 'active';
