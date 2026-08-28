# rahlwes.eu

Website of Ann-Kathrin Rahlwes, historian in Frankfurt am Main. Astro on
Cloudflare Workers, content in Git, edited through Keystatic, translated with
DeepL.

Editing instructions for non-developers live in [REDAKTION.md](./REDAKTION.md).

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

## Content model

German is the source of truth. Each collection is a directory per locale, and
the entry id is `<locale>/<slug>`:

```
src/content/
  home/<locale>/index.json     # homepage singleton
  pages/<locale>/*.mdx         # Über mich, Impressum, Datenschutz
  projects/<locale>/*.mdx      # Ausstellung / Digital / Material
  journal/<locale>/*.mdx       # blog posts
```

Routing mirrors that: `src/pages/*` serves German, `src/pages/[locale]/*` serves
the translated locales via `getStaticPaths`. A locale missing a home entry falls
back to German rather than 404-ing.

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
