-- One campaign per newsletter and language.
--
-- Dispatch trusts the `status` in the content repository, which is only flipped to
-- "sent" by hand afterwards, so a second tab or a replayed request could mail the whole
-- list again. A unique index makes the database the arbiter: the second INSERT fails
-- and dispatch reports it, whichever client sent the request.
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_slug_locale ON campaigns (slug, locale);
