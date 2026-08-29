-- A dispatched newsletter, snapshotted at send time.
--
-- The body is rendered once here rather than per recipient: every subscriber gets
-- identical HTML, and a queue message caps out at 128 KB, which a newsletter body
-- repeated per message would approach fast.
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL,
  locale TEXT NOT NULL,
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per (campaign, subscriber), claimed before the send.
--
-- Queues redeliver on failure and can deliver twice on success, so without a
-- per-recipient record a retry would mail the same person again. `status` is the
-- idempotency key: the consumer skips anything already 'sent'.
CREATE TABLE IF NOT EXISTS campaign_sends (
  campaign_id INTEGER NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  subscriber_id INTEGER NOT NULL REFERENCES subscribers (id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (campaign_id, subscriber_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_sends_status ON campaign_sends (campaign_id, status);
