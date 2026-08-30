# rahlwes.eu

Website of Ann-Kathrin Rahlwes, historian in Frankfurt am Main. Astro on
Cloudflare Workers, content in Git, edited through Keystatic, translated with
DeepL.

Editing instructions for non-developers live in [REDAKTION.md](./REDAKTION.md);
the day-to-day URLs are under [Admin surfaces](#admin-surfaces). If you are an agent
working on this repo, read [AGENTS.md](./AGENTS.md) first — it collects the traps that
this codebase has already sprung.

## Stack

| Concern | Choice |
| --- | --- |
| Framework | Astro 7, static output, zero client JS on content pages |
| Hosting | Cloudflare Workers with static assets (`wrangler deploy`) |
| CMS | Keystatic at `/keystatic`, GitHub storage in production |
| Content | MDX + JSON under `src/content/<collection>/<locale>/` |
| i18n | Astro i18n routing, `de` unprefixed, `/en/` and `/fr/` prefixed |
| Translation | DeepL via our DeepLX worker (`scripts/translate.mjs`) |
| Base theme | [accessible-astro-starter](https://github.com/incluud/accessible-astro-starter), WCAG 2.2 AA |

## Commands

```sh
npm install
npm run dev        # localhost:4321, editor at /keystatic
npm run build      # production build into dist/
npm run preview    # run the built worker locally via wrangler
npm run deploy     # build + wrangler deploy
npm run translate  # DE -> EN/FR for the whole content tree
npm run rephrase -- draft.md   # DeepL Write polish for German prose
```

`npm run translate` and `npm run rephrase` read `DEEPLX_URL` and `DEEPLX_TOKEN`
from `.env` (not committed).

## Admin surfaces

Everything behind `/admin/*` and `/api/admin/*` is gated by `src/middleware.ts`,
which checks the Keystatic GitHub cookie for push access to this repository. There is
no separate password: whoever can edit the site can also send a newsletter. Locally
the same URLs work against `http://localhost:4321`.

| Page | Production URL | What it does |
| --- | --- | --- |
| Editor | [/keystatic](https://next.rahlwes.eu/keystatic) | Keystatic CMS — pages, projects, journal, newsletters |
| Subscribers | [/admin/subscribers/](https://next.rahlwes.eu/admin/subscribers/) | List, import, delete, reactivate bounced addresses |
| Dispatch | [/admin/newsletter/](https://next.rahlwes.eu/admin/newsletter/) | Send a newsletter marked *Bereit zum Versand* |
| Mail preview | [/admin/preview?locale=de&slug=…](https://next.rahlwes.eu/admin/preview?locale=de&slug=example) | Renders one newsletter body as bare HTML |
| Ausschreibungen | [/admin/cfps/](https://next.rahlwes.eu/admin/cfps/) | Collected calls (Stipendien, Preise, Residenzen, Aufträge) + digest recipients |
| Archivsuche | [/admin/search/](https://next.rahlwes.eu/admin/search/) | Ankai's archive search, behind this site's login |
| Admin-Übersicht | [/admin/](https://next.rahlwes.eu/admin/) | Links to all admin interfaces |

The endpoints behind those pages, for when something needs poking by hand:

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/admin/subscribers` | `POST` | Bulk import (`{ emails, locale }`) |
| `/api/admin/subscribers` | `DELETE` | Remove one subscriber (`{ id }`) |
| `/api/admin/subscribers` | `PATCH` | Clear a bounce flag (`{ id }`) |
| `/api/admin/bounces` | `POST` | Run the suppression-list reconciliation now |
| `/api/admin/newsletter/dispatch` | `POST` | Queue a campaign (`{ slug, locale }`) |
| `/api/admin/cfps/subscribe` | `POST` | Add a digest recipient (`{ email }`) |
| `/api/admin/cfps/subscribe` | `DELETE` | Remove a digest recipient (`{ email }`) |

Public newsletter routes, for reference: `/newsletter/` (signup),
`/newsletter/abmelden/` (unsubscribe), `/api/newsletter/subscribe`,
`/api/newsletter/verify`, `/api/newsletter/unsubscribe`. Each exists per locale under
`/en/` and `/fr/` as well.

Two Ausschreibungen routes sit outside `/api/admin` on purpose, and carry their own
credential instead: `/api/cfps/notify` (`POST`) is called by the scrape workflow with
the `CFP_WEBHOOK_SECRET` bearer token, because a GitHub Action has no Keystatic
cookie to present, and `/api/cfps/unsubscribe?token=…` is followed by a digest
recipient who was never an admin.

Unauthenticated requests redirect to the GitHub login (pages) or answer `401` (APIs).
The API routes sit behind Astro's CSRF check, so a manual `curl` needs
`-H 'origin: https://next.rahlwes.eu'` — the sole exception is the RFC 8058 one-click
unsubscribe, which mail clients post cross-origin.

## Content model

German is the source of truth. Each collection is a directory per locale, and
the entry id is `<locale>/<slug>`:

```
src/content/
  home/<locale>/index.json     # homepage singleton
  pages/<locale>/*.mdx         # Über mich, Impressum, Datenschutz
  projects/<locale>/*.mdx      # Ausstellung / Digital / Material
  journal/<locale>/*.mdx       # blog posts
  newsletters/<locale>/*.mdx   # newsletter issues, never routed publicly
```

Routing mirrors that: `src/pages/*` serves German, `src/pages/[locale]/*` serves
the translated locales via `getStaticPaths`. A locale missing a home entry falls
back to German rather than 404-ing.

## Newsletter

Self-hosted, no third-party mailing platform. Editorial instructions are in
[REDAKTION.md](./REDAKTION.md); this is the plumbing.

| Piece | Where |
| --- | --- |
| Subscribers, campaigns, per-send state | D1 `NEWSLETTER_DB` (`migrations/`) |
| One queue message per recipient | Queue `NEWSLETTER_QUEUE` |
| Delivery | `NEWSLETTER_EMAIL` binding, sender `newsletter@marketing.rahlwes.eu` |
| Signup throttle | Rate limiter `NEWSLETTER_LIMIT` (3/60s per IP) |
| Internal render call | Service binding `SELF` |
| Bounce reconciliation | Cron `17 4 * * *` + Email Sending suppression API |

Apply schema changes with
`npx wrangler d1 migrations apply rahlwes-newsletter --remote`.

**Queue consumer.** The Cloudflare adapter only exports `fetch`, so
`src/newsletter/integration.ts` repoints the SSR build input at
`src/worker.ts`, which re-exports the adapter's `fetch` next to a `queue`
handler. Both land in one Worker; `wrangler deploy` reports it as producer *and*
consumer.

Two things in that worker are deliberate and easy to break:

- The RFC 8058 one-click unsubscribe is answered in `src/worker.ts` **before**
  Astro's CSRF check, which would otherwise reject the cross-origin POST mail
  clients send. The exemption is limited to that one path and requires a valid
  token.
- Dispatch renders MDX by calling `/admin/preview` through the `SELF` binding.
  Fetching the public hostname from inside the Worker loops back through the edge
  and fails with a 522.

**Idempotency.** `campaign_sends` holds one row per (campaign, subscriber). The
consumer claims a row before sending, so a queue retry cannot mail anyone twice.
Permanent Email Sending errors are recorded and not retried; transient ones throw
and are redelivered.

**Languages.** Two locales are stored per subscriber, because they answer different
questions:

| Column | Meaning |
| --- | --- |
| `locale` | One of `de`/`en`/`fr`; the language every mail to this person uses |
| `browser_locale` | Raw `Accept-Language` tag (`fr-CH`, `pt-BR`), defaulting to `de` |

`src/i18n/accept-language.ts` ranks the header by q-value. `matchLocale` returns the
best language the site publishes, falling back to the page the reader signed up on
when it publishes none of them — a `pt-BR` browser on the German page is mailed in
German but stored as `pt-BR`, which is how a demand for a fourth translation becomes
visible. Imported addresses have no browser, so both columns take the locale chosen
for the import.

Transactional mail follows `locale`, not the page: the newsletter confirmation and the
contact-form confirmation are sent in the reader's own language, while the on-page
reply stays in the language of the page they are looking at. The contact notification
to Ann-Kathrin reports both when they differ, so she knows which language to answer in.

**Where the contact form lives.** There is no standalone contact page — the original
Squarespace site had none either. `ContactCta` closes every page that sells her work,
driven by a `contactCta` flag that defaults to on for pages, projects and journal
entries; the legal pages set it to `false`. The index layouts render the band
directly. `/kontakt` 301s to `/#kontakt` so older links still land on a form.

**Contact-form opt-in.** Every contact form carries a second, unticked checkbox
that starts a newsletter subscription. It runs the same double opt-in as the signup
form — `src/newsletter/enroll.ts` is shared by both — so the address only joins the
list once its confirmation link is followed, and a contact form cannot be used to
subscribe somebody else. An address that has already confirmed is left untouched:
no duplicate row, no second confirmation, and its unsubscribe token survives so the
links in mail it already received keep working.

The box is deliberately separate from the contact consent and never pre-ticked;
bundling the two would not be valid consent. Enrolment failures are logged and
swallowed, because a newsletter problem must not tell someone their message was
lost when it was already delivered.

**Sending domains.** Two `send_email` bindings, one per domain, each restricted
to the addresses it may use:

| Binding | Sender | Used by |
| --- | --- | --- |
| `EMAIL` | `kontakt@send.rahlwes.eu` | contact form |
| `NEWSLETTER_EMAIL` | `newsletter@marketing.rahlwes.eu` | newsletter confirmation + dispatch |

Receivers score reputation per sending domain. Bulk newsletter mail attracts spam
complaints that transactional mail does not, so it sends from its own subdomain;
a bad campaign cannot then sink the contact-form replies. `allowed_sender_addresses`
makes the split a runtime constraint rather than a convention about which constant a
call site imports.

Onboard a new sending domain with `wrangler email sending enable <domain>`; SPF,
DKIM, DMARC and the bounce MX records are provisioned automatically. Verify with
`wrangler email sending dns get <domain>`.

**Bounces.** The `EMAIL` binding resolves once a message is *accepted*; a hard
bounce lands hours later and Cloudflare adds the address to the account-wide
suppression list. There is no webhook, so `src/newsletter/suppressions.ts` polls
that list daily via the `scheduled` handler and sets `subscribers.bounced_at`.
Dispatch selects `verified = 1 AND bounced_at IS NULL`, so a dead address drops out
of the next send.

The synchronous case is handled too: `E_RECIPIENT_SUPPRESSED` and
`E_RECIPIENT_NOT_ALLOWED` during a send flag the subscriber immediately rather than
waiting for the next poll.

Bounced rows are kept, not deleted, so the admin list can explain why someone
stopped receiving mail. *Reaktivieren* clears the flag, but Cloudflare's own
suppression is authoritative — if the address is still suppressed there, the next
reconciliation re-flags it.

Requires `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (scoped to *Account >
Email Sending > Read*) as Worker secrets; see `.env.example`. Without them sending
still works and only bounce detection is inactive.

**Admin auth.** `src/middleware.ts` guards `/admin/*` and `/api/admin/*` by
checking the Keystatic GitHub token for push access to the content repo — no
second password. Anyone who can edit the site can send a newsletter. The URLs are
listed under [Admin surfaces](#admin-surfaces).

## Archive search

`/admin/search/` is [Ankai](https://search.rahlwes.eu)'s search UI, ported into Astro so it
sits behind the Keystatic guard rather than Ankai's shared password. For records about
named victims of persecution that is the higher bar: push access to the content repo,
revocable, instead of a password that gets pasted into chats.

Ankai stays a separate Worker with its own repo, D1 and provider catalog. **Only the UI
lives here** — adapters, the fan-out and the Zod schemas stay there, and
`src/ankai/types.ts` mirrors just the response shape the island reads. The source toggles
are fetched from `/v1/sources` at request time rather than hard-coded, so they cannot
drift from what the server actually queries.

Requests go through `/api/admin/ankai/*`, which attaches `ANKAI_PASSWORD` server-side.
That proxy is not optional: Ankai sends no CORS headers and its `ankai_auth` cookie is
scoped to its own host, so a browser on this origin can neither call it nor authenticate
against it. The proxy allows exactly two read endpoints — `persons/search` and `sources`.
`/admin/ingest/*` is deliberately not reachable, because it rewrites the D1 corpus.

Set `ANKAI_PASSWORD` to Ankai's own `ACCESS_PASSWORD`; without it the page renders a
configuration notice instead of a broken form. `ANKAI_ORIGIN` optionally points a dev
build at a local Ankai.

## Analytics

Cloudflare Web Analytics, enabled for `next.rahlwes.eu`. The beacon is rendered by
`DefaultLayout.astro` from `PUBLIC_CF_BEACON_TOKEN`; without that variable nothing is
emitted, so local builds and forks stay unmeasured.

It is written out explicitly rather than left to the zone's automatic injection, which
rewrites buffered HTML and is unreliable for the streamed SSR responses this site sends.

**Why not a self-hosted tracker.** Counterscale and similar tools count *unique* visitors
by writing a `Last-Modified` value into the browser cache and reading it back through
`If-Modified-Since`. EDPB Guidelines 2/2023 name caching mechanisms in paragraph 42 as
access to terminal equipment, so that needs opt-in consent under § 25 TDDDG — a banner,
on every page. Cloudflare's beacon sets no cookie, writes no `localStorage` and does not
fingerprint (verified in a browser: zero cookies, empty storage), so it needs no banner.
The trade is real: no unique-visitor counts. On a portfolio a banner would suppress more
signal than the extra metric returns.

`datenschutz.mdx` describes exactly this and nothing else. It previously declared Google
Analytics with cookies, user profiles and stored IPs, inherited from the Squarespace
import and untrue since the migration.

## Design tokens

Brand colours are carried over from the previous Squarespace theme and live in
two places that must stay in sync: `theme.config.ts` (injected as CSS variables
by `DefaultLayout.astro`) and the fallbacks in
`src/assets/scss/base/_root.scss`.

- ink `#6f534f`, accent `#6673b6`, neutral `#c4bab4`, outline `#b6664f`
- PT Sans (400/700) via Astro's font API — the typeface of the old site

## Deployment

The custom domain `next.rahlwes.eu` is declared in `wrangler.jsonc`. The zone
already lives in the Cloudflare account, so `npm run deploy` provisions the
route and certificate on first run.
