-- The language the subscriber's browser asked for, as a BCP-47 tag.
--
-- Distinct from `locale`, which is one of the three languages the site publishes and
-- decides which language we mail them. `browser_locale` is the raw signal and may name
-- a language the site does not serve (`pt-BR`, `nl`), which is what makes it worth
-- keeping: it shows which translations the audience actually wants.
--
-- Defaults to 'de' so existing rows and header-less requests carry the site's own
-- source language rather than a null every reader has to special-case.
ALTER TABLE subscribers ADD COLUMN browser_locale TEXT NOT NULL DEFAULT 'de';
