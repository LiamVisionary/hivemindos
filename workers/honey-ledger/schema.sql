CREATE TABLE IF NOT EXISTS usage_receipts (
  event_id TEXT PRIMARY KEY,
  issuer_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  tokens_used INTEGER NOT NULL CHECK (tokens_used > 0),
  honey_delta_micro INTEGER NOT NULL DEFAULT 0 CHECK (honey_delta_micro >= 0),
  model TEXT NOT NULL,
  source TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  signature TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agent_balances (
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  lifetime_honey REAL NOT NULL DEFAULT 0,
  available_honey REAL NOT NULL DEFAULT 0,
  hive_balance REAL NOT NULL DEFAULT 0,
  lifetime_honey_micro INTEGER NOT NULL DEFAULT 0,
  available_honey_micro INTEGER NOT NULL DEFAULT 0,
  hive_balance_micro INTEGER NOT NULL DEFAULT 0,
  managed_honey_balance_micro INTEGER NOT NULL DEFAULT 0 CHECK (managed_honey_balance_micro >= 0),
  managed_honey_lifetime_credit_micro INTEGER NOT NULL DEFAULT 0 CHECK (managed_honey_lifetime_credit_micro >= 0),
  managed_honey_spent_micro INTEGER NOT NULL DEFAULT 0 CHECK (managed_honey_spent_micro >= 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (workspace_id, agent_id)
);

CREATE TABLE IF NOT EXISTS exchange_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  honey_delta REAL NOT NULL,
  hive_delta REAL NOT NULL,
  honey_delta_micro INTEGER NOT NULL DEFAULT 0,
  hive_delta_micro INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reward_pool_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  total_pool_micro INTEGER NOT NULL DEFAULT 0 CHECK (total_pool_micro >= 0),
  emitted_micro INTEGER NOT NULL DEFAULT 0 CHECK (emitted_micro >= 0),
  exchanged_micro INTEGER NOT NULL DEFAULT 0 CHECK (exchanged_micro >= 0),
  total_pool_usd_micro INTEGER NOT NULL DEFAULT 0 CHECK (total_pool_usd_micro >= 0),
  total_volume_usd_micro INTEGER NOT NULL DEFAULT 0 CHECK (total_volume_usd_micro >= 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reward_pool_events (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  trade_volume_usd_micro INTEGER NOT NULL DEFAULT 0 CHECK (trade_volume_usd_micro >= 0),
  hive_price_usd_micro INTEGER NOT NULL DEFAULT 0 CHECK (hive_price_usd_micro >= 0),
  reward_pool_usd_micro INTEGER NOT NULL DEFAULT 0 CHECK (reward_pool_usd_micro >= 0),
  reward_pool_hive_micro INTEGER NOT NULL CHECK (reward_pool_hive_micro > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

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

CREATE INDEX IF NOT EXISTS idx_usage_workspace_agent ON usage_receipts(workspace_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_usage_created_at ON usage_receipts(created_at);
CREATE INDEX IF NOT EXISTS idx_balances_workspace ON agent_balances(workspace_id);
CREATE INDEX IF NOT EXISTS idx_reward_pool_events_created_at ON reward_pool_events(created_at);
CREATE INDEX IF NOT EXISTS idx_managed_billing_workspace_agent ON managed_billing_events(workspace_id, agent_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_managed_billing_idempotency
  ON managed_billing_events(workspace_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND idempotency_key != '';
