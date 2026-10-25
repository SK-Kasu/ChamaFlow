ALTER TABLE contributions
  DROP CONSTRAINT IF EXISTS contributions_payment_method_check;

ALTER TABLE contributions
  ADD CONSTRAINT contributions_payment_method_check
  CHECK (payment_method IN ('manual', 'simulated', 'mpesa_sandbox'));

CREATE TABLE IF NOT EXISTS payment_transactions (
  id UUID PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES chama_groups(id) ON DELETE RESTRICT,
  contribution_id INTEGER REFERENCES contributions(id) ON DELETE RESTRICT,
  transaction_type VARCHAR(16) NOT NULL
    CHECK (transaction_type IN ('collection', 'payout', 'refund', 'reversal', 'adjustment')),
  provider VARCHAR(24) NOT NULL,
  environment VARCHAR(12) NOT NULL CHECK (environment = 'sandbox'),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency CHAR(3) NOT NULL DEFAULT 'KES',
  status VARCHAR(24) NOT NULL
    CHECK (status IN ('initiated', 'pending', 'succeeded', 'failed', 'verification_required', 'reversed')),
  idempotency_key VARCHAR(128) NOT NULL,
  account_reference VARCHAR(16) NOT NULL,
  provider_merchant_request_id VARCHAR(128),
  provider_checkout_request_id VARCHAR(128),
  provider_transaction_id VARCHAR(128),
  failure_code VARCHAR(64),
  failure_reason VARCHAR(240),
  initiated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  initiated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (group_id, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_transactions_active_contribution_idx
  ON payment_transactions (contribution_id)
  WHERE transaction_type = 'collection'
    AND status IN ('initiated', 'pending', 'verification_required');

CREATE UNIQUE INDEX IF NOT EXISTS payment_transactions_checkout_request_idx
  ON payment_transactions (provider, provider_checkout_request_id)
  WHERE provider_checkout_request_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payment_transactions_provider_transaction_idx
  ON payment_transactions (provider, provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payment_transactions_group_created_idx
  ON payment_transactions (group_id, initiated_at DESC);

CREATE TABLE IF NOT EXISTS payment_provider_events (
  id BIGSERIAL PRIMARY KEY,
  provider VARCHAR(24) NOT NULL,
  payment_id UUID REFERENCES payment_transactions(id) ON DELETE RESTRICT,
  checkout_request_id VARCHAR(128),
  payload_sha256 CHAR(64) NOT NULL,
  event_type VARCHAR(32) NOT NULL,
  processing_result VARCHAR(32) NOT NULL DEFAULT 'received'
    CHECK (processing_result IN ('received', 'verified', 'ignored', 'verification_failed')),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  UNIQUE (provider, payload_sha256)
);

CREATE INDEX IF NOT EXISTS payment_provider_events_payment_idx
  ON payment_provider_events (payment_id, received_at DESC);

CREATE TABLE IF NOT EXISTS ledger_accounts (
  id BIGSERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES chama_groups(id) ON DELETE RESTRICT,
  code VARCHAR(32) NOT NULL CHECK (code IN ('group_funds', 'contributions_collected')),
  currency CHAR(3) NOT NULL DEFAULT 'KES',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (group_id, code, currency)
);

CREATE OR REPLACE FUNCTION prevent_financial_record_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Financial history is immutable; record a compensating entry instead.';
END;
$$;

DROP TRIGGER IF EXISTS ledger_accounts_immutable ON ledger_accounts;
CREATE TRIGGER ledger_accounts_immutable
  BEFORE UPDATE OR DELETE ON ledger_accounts
  FOR EACH ROW EXECUTE FUNCTION prevent_financial_record_changes();

CREATE TABLE IF NOT EXISTS ledger_entries (
  id BIGSERIAL PRIMARY KEY,
  payment_id UUID NOT NULL REFERENCES payment_transactions(id) ON DELETE RESTRICT,
  account_id BIGINT NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
  amount_minor BIGINT NOT NULL CHECK (amount_minor <> 0),
  currency CHAR(3) NOT NULL DEFAULT 'KES',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (payment_id, account_id)
);

CREATE INDEX IF NOT EXISTS ledger_entries_account_created_idx
  ON ledger_entries (account_id, created_at DESC);

DROP TRIGGER IF EXISTS ledger_entries_immutable ON ledger_entries;
CREATE TRIGGER ledger_entries_immutable
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_financial_record_changes();

CREATE OR REPLACE FUNCTION verify_payment_ledger_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  entry_count INTEGER;
  account_count INTEGER;
  total_minor BIGINT;
  invalid_entry_count INTEGER;
BEGIN
  SELECT COUNT(*), COUNT(DISTINCT e.account_id), COALESCE(SUM(e.amount_minor), 0),
         COUNT(*) FILTER (
           WHERE e.currency <> t.currency
              OR a.currency <> t.currency
              OR a.group_id <> t.group_id
         )
    INTO entry_count, account_count, total_minor, invalid_entry_count
    FROM ledger_entries e
    JOIN payment_transactions t ON t.id = e.payment_id
    JOIN ledger_accounts a ON a.id = e.account_id
   WHERE e.payment_id = NEW.payment_id;

  IF entry_count <> 2 OR account_count <> 2 OR total_minor <> 0 OR invalid_entry_count <> 0 THEN
    RAISE EXCEPTION 'Payment ledger entries must balance across two accounts in one group and currency.';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS ledger_entries_balanced ON ledger_entries;
CREATE CONSTRAINT TRIGGER ledger_entries_balanced
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION verify_payment_ledger_balance();

CREATE TABLE IF NOT EXISTS payment_audit (
  id BIGSERIAL PRIMARY KEY,
  payment_id UUID NOT NULL REFERENCES payment_transactions(id) ON DELETE RESTRICT,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(48) NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payment_audit_payment_created_idx
  ON payment_audit (payment_id, created_at DESC);

DROP TRIGGER IF EXISTS payment_audit_immutable ON payment_audit;
CREATE TRIGGER payment_audit_immutable
  BEFORE UPDATE OR DELETE ON payment_audit
  FOR EACH ROW EXECUTE FUNCTION prevent_financial_record_changes();
