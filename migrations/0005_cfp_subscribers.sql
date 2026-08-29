-- Recipients of the daily Call-for-Proposals digest.
--
-- Deliberately separate from `subscribers`: that list is the public newsletter,
-- this one is an internal research feed only the admin adds addresses to. Merging
-- them would mail CfPs to people who consented to the newsletter and nothing else.
--
-- No double opt-in here for the same reason — the only way onto this table is an
-- authenticated admin request, so there is no unverified address to confirm.
CREATE TABLE IF NOT EXISTS cfp_subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  unsubscribe_token TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The token arrives as a URL parameter and is looked up on every click.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cfp_subscribers_unsubscribe_token ON cfp_subscribers (unsubscribe_token);
