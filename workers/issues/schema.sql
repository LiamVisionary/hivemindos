-- hivemindos-issues: anonymized client health reports from desktop installs.
-- One row per (install, issue fingerprint); repeat occurrences bump `count`
-- and `last_seen_at` instead of inserting duplicates, so a single install stuck
-- in a retry loop never floods the table.
CREATE TABLE IF NOT EXISTS issues (
  id            TEXT PRIMARY KEY,          -- deterministic fingerprint (see worker)
  kind          TEXT NOT NULL,             -- e.g. "hydration_stall"
  severity      TEXT NOT NULL DEFAULT 'error',
  install_id    TEXT,                      -- anonymized random id, stable per install
  app_version   TEXT,
  commit_sha    TEXT,
  platform      TEXT,                      -- coarse os/arch or UA hint, no PII
  detail        TEXT,                      -- short human summary
  failure_kind  TEXT,                      -- network | server | non-json | ...
  status_code   INTEGER,                   -- HTTP status when relevant
  attempt       INTEGER,                   -- attempt count at first report
  context       TEXT,                      -- small JSON blob, size-capped
  count         INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,             -- first seen (UTC ISO-8601)
  last_seen_at  TEXT NOT NULL              -- most recent occurrence
);

CREATE INDEX IF NOT EXISTS idx_issues_last_seen ON issues(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_issues_kind      ON issues(kind);
CREATE INDEX IF NOT EXISTS idx_issues_install   ON issues(install_id);

-- Per-install daily counter backing DAILY_REPORT_CAP (abuse bound).
CREATE TABLE IF NOT EXISTS report_quota (
  install_id TEXT NOT NULL,
  day        TEXT NOT NULL,                -- UTC YYYY-MM-DD
  count      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (install_id, day)
);
