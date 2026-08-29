-- Bounce state for a subscriber.
--
-- A hard bounce usually arrives long after `send()` returned success, so this is
-- not derivable from the send call alone: it is reconciled from Cloudflare's
-- account suppression list. Keeping the address (rather than deleting it) means a
-- re-signup is recognised as a returning address, and the admin list can explain
-- why someone stopped receiving mail.
ALTER TABLE subscribers ADD COLUMN bounced_at TEXT;
ALTER TABLE subscribers ADD COLUMN bounce_reason TEXT;

-- Dispatch filters on `verified = 1 AND bounced_at IS NULL`.
CREATE INDEX IF NOT EXISTS idx_subscribers_bounced ON subscribers (bounced_at);
