-- Screen-share snapshots (D42, spec 08). One row per share code: the latest clock snapshot, the
-- SHA-256 of its write key, and an expiry a day after the last write. No photos or chip inventory.
CREATE TABLE IF NOT EXISTS screens (
  code TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL,
  body TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS screens_expires_at ON screens (expires_at);
