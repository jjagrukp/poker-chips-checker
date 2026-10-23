-- Rate-limit counters for /api/analyse-chips (D35). Keys hold a hashed IP or the day, never an image.
CREATE TABLE IF NOT EXISTS rate_counts (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_counts_expires_at ON rate_counts (expires_at);
