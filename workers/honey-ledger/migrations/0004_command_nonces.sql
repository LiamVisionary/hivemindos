-- Single-use nonces for signed value-moving commands (exchange / return-to-honey /
-- claim-bankr-hive). A command's event_id may be applied at most once, which gives
-- replay protection and idempotency for the irreversible Bankr HIVE transfer.
CREATE TABLE IF NOT EXISTS command_nonces (
  event_id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_command_nonces_created_at ON command_nonces(created_at);
