-- When the last confirmation mail went to this address.
--
-- The signup rate limit is per IP, so rotating addresses could still send one
-- stranger's inbox a confirmation on every request. Enrolment skips the mail while
-- the previous one is recent; the pending link stays valid, so a real reader who
-- clicks "subscribe" twice loses nothing.
ALTER TABLE subscribers ADD COLUMN confirmation_sent_at TEXT;
