-- Subscriber list for the newsletter.
--
-- `verified` gates every send: rows created by the public form start at 0 and only
-- flip to 1 once the double opt-in link is followed. Imported rows start at 1
-- because they opted in elsewhere.
CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  locale TEXT NOT NULL DEFAULT 'de',
  verified INTEGER NOT NULL DEFAULT 0,
  verify_token TEXT,
  unsubscribe_token TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Both tokens arrive as URL parameters and are looked up on every click, so they
-- need to resolve without a table scan.
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscribers_verify_token ON subscribers (verify_token);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscribers_unsubscribe_token ON subscribers (unsubscribe_token);

-- Dispatch selects strictly on this column.
CREATE INDEX IF NOT EXISTS idx_subscribers_verified ON subscribers (verified);
