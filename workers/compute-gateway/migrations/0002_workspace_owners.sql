-- Binds a workspace to the Bankr LLM key that first earned Honey through it, so that
-- Honey redemption can verify the caller controls the funding credential. Stores only
-- the SHA-256 of the key, never the raw key.
CREATE TABLE IF NOT EXISTS workspace_owners (
  workspace_id TEXT PRIMARY KEY,
  bankr_key_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
