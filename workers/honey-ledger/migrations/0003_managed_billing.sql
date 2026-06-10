ALTER TABLE agent_balances ADD COLUMN managed_honey_balance_micro INTEGER NOT NULL DEFAULT 0 CHECK (managed_honey_balance_micro >= 0);
ALTER TABLE agent_balances ADD COLUMN managed_honey_lifetime_credit_micro INTEGER NOT NULL DEFAULT 0 CHECK (managed_honey_lifetime_credit_micro >= 0);
ALTER TABLE agent_balances ADD COLUMN managed_honey_spent_micro INTEGER NOT NULL DEFAULT 0 CHECK (managed_honey_spent_micro >= 0);

CREATE TABLE IF NOT EXISTS managed_billing_events (
  event_id TEXT PRIMARY KEY,
  issuer_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('credit', 'debit')),
  honey_delta_micro INTEGER NOT NULL CHECK (honey_delta_micro != 0),
  usd_amount_micro INTEGER NOT NULL DEFAULT 0 CHECK (usd_amount_micro >= 0),
  provider TEXT NOT NULL,
  sku TEXT NOT NULL,
  units REAL NOT NULL DEFAULT 0,
  unit_usd_micro INTEGER NOT NULL DEFAULT 0 CHECK (unit_usd_micro >= 0),
  markup_bps INTEGER NOT NULL DEFAULT 0 CHECK (markup_bps >= 0),
  source TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  signature TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT,
  metadata_hash TEXT,
  applied INTEGER NOT NULL DEFAULT 0 CHECK (applied IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_managed_billing_workspace_agent ON managed_billing_events(workspace_id, agent_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_managed_billing_idempotency
  ON managed_billing_events(workspace_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND idempotency_key != '';
