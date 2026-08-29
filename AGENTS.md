# Working on this repo

Ann-Kathrin Rahlwes' website. Read [README.md](./README.md) for the architecture and
[REDAKTION.md](./REDAKTION.md) for how she uses it. This file is the things that are
easy to get wrong.

## Verify against production, not against the build

`npm run build` passing proves very little here. The Cloudflare runtime, the D1
bindings and the email service only exist once deployed, so a change to anything under
`src/newsletter/`, `src/pages/api/` or `src/worker.ts` is unverified until it has run
on `next.rahlwes.eu`.

```sh
npm run deploy                       # build + wrangler deploy
npx wrangler d1 execute rahlwes-newsletter --remote --command "SELECT …"
```

`wrangler dev --remote` currently fails with `SESSION bindings must have an "id" field`
— deploy instead of trying to fix that in passing.

Delete test rows when finished. Real sends cost reputation.

## Never send test mail to `@example.com`

Those addresses bounce, and Cloudflare scores bounce rate per sending domain. Use a
real mailbox you control. There are already 41 `deliveryFailed` events on
`send.rahlwes.eu` from exactly this mistake.

Two sending domains, deliberately separate — see *Sending domains* in the README.
Bulk mail must stay on `marketing.rahlwes.eu`.

## The content is imported from Squarespace and is damaged

A previous importer dropped every inline image and kept the captions, so pages end
with orphaned sentences that used to sit under a photo. Do not "tidy up" prose that
reads as a stray fragment — it is usually a caption whose image is gone.

Known outstanding, measured against the live Squarespace originals:

| Page | Missing images |
| --- | ---: |
| `/journal/familienerforschen/` | 18 (imported as "Im Vollbildmodus anzeigen" links) |
| `/projekte/notaufnahmelager-giessen/` | 9 |
| `/projekte/unterrichtsmaterial/` | 6 |
| `/projekte/ausstellung-und-forschung/` | 3 |
| `/ueber-mich/` | 2 |
| `/projekte/wir-sind-jetzt/` | 2 |
| `/projekte/geerbt-gekauft-geraubt/` | 2 |
| `/projekte/digitales-storytelling/` | 2 |
| `/projekte/nachgefragt/` | 1 |

Separately, 101 `images.squarespace-cdn.com` hotlinks remain across 12 files
(`digitale-spiele`, `orteerforschen`, `gab-es-zwangsarbeit`, `familienerforschen` in
all three locales). Those pages look fine today and will break when the Squarespace
subscription lapses. `/fuer-museen/` has been restored and is the worked example.

When restoring a page, fetch the original from `https://rahlwes.eu/<old-path>` (see
`src/redirects.ts` for the mapping), download the images into `src/assets/uploads/`,
and reference them through `ContentImage` / `ImageCard` / `Illustration` so they go
through Astro's asset pipeline. Check for byte-identical duplicates first — she reuses
illustrations, and Astro deduplicates them anyway.

## Layout: `.prose` is capped at the reading measure

`ArticlePage.astro` sets `max-inline-size: var(--font-measure)` (70ch). That is right
for text and wrong for grids and full-width illustrations, which break out of it via
`margin-inline-end` (see `CardGrid.astro`). Do not widen `.prose` globally: journal
posts depend on the narrow measure.

`margin-inline: auto` cannot centre an element wider than its parent — it resolves to
`0` and the element hangs off to one side. The prose column is left-aligned inside
`.container`, so breakouts grow rightward rather than centring.

## Translations go through the translate skill

German is the source. `npm run translate` handles content; for one-off strings use the
DeepLX worker rather than translating inline. `/translate` rejects `EN-GB` — use bare
`EN`. It rate-limits around 5 requests, so space calls out and retry on `429`.

Human translations already in the repo beat machine output: when restructuring an
`en`/`fr` page, keep its existing prose and only translate what is genuinely new.

## Astro gotchas that cost time here

- **Stale content cache.** After deleting or renaming anything under `src/content/`,
  remove `node_modules/.astro/data-store.json` or the build fails resolving a module
  for a file that no longer exists.
- **Nested dynamic routes under a static path** are shadowed by the site-wide
  `/[locale]/` route. `/admin/newsletter/preview/[locale]/[slug]` silently 404ed;
  `/admin/preview?locale=&slug=` works.
- **A Worker cannot fetch its own public hostname** — it loops back through the edge
  and returns 522. Use the `SELF` service binding.
- **Astro's CSRF check rejects cross-origin POSTs.** That is correct for forms and
  wrong for RFC 8058 unsubscribe, which is why that one path is answered in
  `src/worker.ts` ahead of the framework.

## Conventions

- Comments explain **why**, never what. Delete restating comments in code you touch.
- Match the surrounding file: flat i18n keys, `satisfies Record<Locale, …>` for
  per-language tables, `Record<string, true>` for small static lookups over `Set`.
- Every user-facing string exists in `de`, `en` and `fr`. A missing key is a type
  error by design — keep it that way.
- Legal pages (`impressum`, `datenschutz`) are German-only on purpose; every locale
  links the original.
- Never add `Co-Authored-By` or attribution lines to commits.
