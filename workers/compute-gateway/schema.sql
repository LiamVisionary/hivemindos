CREATE TABLE IF NOT EXISTS workspace_daily_usage (
  workspace_id TEXT NOT NULL,
  usage_date TEXT NOT NULL,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (workspace_id, usage_date)
);

CREATE TABLE IF NOT EXISTS compute_events (
  event_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  model TEXT NOT NULL,
  tokens_used INTEGER NOT NULL,
  honey_delta REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_compute_events_workspace ON compute_events(workspace_id, created_at);

-- Binds a workspace to the Bankr LLM key that first earned Honey through it. Honey
-- redemption (exchange / return / claim) is authorized only when the caller presents a
-- key whose SHA-256 matches this binding. Stores the hash only, never the raw key.
CREATE TABLE IF NOT EXISTS workspace_owners (
  workspace_id TEXT PRIMARY KEY,
  bankr_key_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Remote feature flags read by GET /honey/config. Key 'honey-economy-enabled' gates
-- whether the app adopts the official Honey economy. Absent row => disabled.
CREATE TABLE IF NOT EXISTS gateway_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
