CREATE TABLE IF NOT EXISTS paid_agent_receipts (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  slug TEXT NOT NULL,
  resource TEXT NOT NULL,
  price_usd REAL NOT NULL,
  network TEXT NOT NULL,
  payer TEXT,
  transaction_hash TEXT,
  payment_amount TEXT,
  settlement_success INTEGER NOT NULL DEFAULT 0,
  upstream_status INTEGER NOT NULL,
  idempotency_key TEXT,
  request_fingerprint TEXT,
  metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_paid_agent_receipts_created_at
  ON paid_agent_receipts(created_at);

CREATE INDEX IF NOT EXISTS idx_paid_agent_receipts_slug_created_at
  ON paid_agent_receipts(slug, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_paid_agent_receipts_slug_idempotency_key
  ON paid_agent_receipts(slug, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND idempotency_key != '';
