-- Remote feature flags served by GET /honey/config. Key 'honey-economy-enabled'
-- gates whether the app adopts the official Honey economy (official ledger + gateway
-- earning/redemption). An absent row means disabled, so this ships dark.
CREATE TABLE IF NOT EXISTS gateway_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
