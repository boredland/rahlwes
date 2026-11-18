# Plan 006: Replace cut-off meta descriptions and add captions to the Nachgefragt trailer

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 14c7500..HEAD -- src/content/pages src/content/projects public/media`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: 004 (the caption file is served by the `/media/*` route that plan 004 fixes; this plan works without 004 but its range checks assume it)
- **Category**: bug (SEO, accessibility)
- **Planned at**: commit `14c7500`, 2026-11-17

## Why this matters

Eleven pages ship a `<meta name="description">` and Open Graph description that stops
mid-sentence: the importer cut each at a character limit and appended `…` or `...`. Search
results and link previews show a broken sentence, in three languages. Separately, the
Nachgefragt trailer has spoken German (children and museum staff) and no captions track,
which excludes deaf and hard-of-hearing visitors (WCAG 2.2 SC 1.2.2). YouTube already
holds German and English caption files for the same video, so the cost is small.
**Rights caveat:** the video belongs to Historisches Museum Frankfurt; the captions are
their work too. Treat the captions exactly like the video: the operator confirms permission
with the museum before this reaches production.

## Current state

### A. Cut-off `seo.description` values (verified by reading each file)

**Root cause (verified in the importers).** The description was produced by a clamp that looks
for the last `". "`, `"! "` or `"? "` inside the first 160 characters and cuts there; when it
finds none past the halfway point it cuts at a space and appends `…`
(`scripts/import-squarespace-pages.mjs:59-65`, `clamp`; `scripts/import-squarespace-en.mjs:58-64`,
`clampDescription`). A German date such as `04. Februar` contains `". "`, so the clamp "found a
sentence end" inside the date and cut there: that is why the en and fr `nachgefragt` values end
in `- 04.` The same function produces the `…` and `...` endings on the other pages.
`scripts/translate.mjs` also lists `description` as a translatable key (line 42), so
`npm run translate` **rewrites** these fields. **Do not re-run an importer or
`npm run translate` on these pages:** it would reproduce the cut. Edit the `description:` value
directly in each file, nothing else.

The `description` is in the YAML frontmatter under `seo:`. Current values and fixes:

| File | Current value (cut off) |
|---|---|
| `src/content/pages/en/fuer-museen.mdx:10` | `"Are you planning an exhibition? Find out here how I can help you as a freelance historian with research and research, exhibition concepts and..."` |
| `src/content/pages/fr/fuer-museen.mdx:10` | `"Vous prévoyez une exposition ? Découvrez ici comment, en tant qu'historienne indépendante, je peux vous aider dans vos recherches, dans la conception de l'exposition et..."` |
| `src/content/projects/en/geerbt-gekauft-geraubt.mdx:10` | `"…the results of its provenance research on the collection of paintings and..."` |
| `src/content/projects/fr/geerbt-gekauft-geraubt.mdx:10` | `"…recherches de provenance sur les..."` |
| `src/content/projects/en/notaufnahmelager-giessen.mdx:10` | `"…the multi-perspective reappraisal of migration stories...."` |
| `src/content/projects/fr/notaufnahmelager-giessen.mdx:10` | `"…l'élaboration multiperspective des histoires de migration..."` |
| `src/content/projects/en/wir-sind-jetzt.mdx:10` | `"…from Anne Frank's ancestors and family as a..."` |
| `src/content/projects/fr/wir-sind-jetzt.mdx:10` | `"…de la famille d'Anne Frank comme..."` |
| `src/content/projects/en/nachgefragt.mdx:10` | `"…(December 09, 2021 - 04."` |
| `src/content/projects/fr/nachgefragt.mdx:10` | `"…(09 décembre 2021 - 04."` |

(`src/content/pages/de/fuer-museen.mdx:10` also ends in `…`; the German source is also in scope.
`datenschutz.mdx:7` and `impressum.mdx:7` are legal pages: **do not touch them**.)

Every one of these pages already has a complete `excerpt:` (projects) or `intro:` (pages)
in the same frontmatter. Do **not** invent text. Where a new description is needed, build
it from the page's own existing sentences, or use the proposals below, which were
written from the pages' own text and are 135-161 characters (search engines show about
155; 160 is the working ceiling).

### B. Proposed replacements (use exactly these; they are original condensations of the page's own `excerpt`/`intro`, not new claims)

| File | New `description` |
|---|---|
| `pages/de/fuer-museen.mdx` | `Sie planen eine Ausstellung? So unterstütze ich Sie als freiberufliche Historikerin bei Recherche, Ausstellungskonzept und Vermittlung.` |
| `pages/en/fuer-museen.mdx` | `Are you planning an exhibition? Here is how I support you as a freelance historian with research, exhibition concepts and communicating history.` |
| `pages/fr/fuer-museen.mdx` | `Vous prévoyez une exposition ? Voici comment je vous accompagne, en tant qu'historienne indépendante, en recherche, conception et médiation.` |
| `projects/en/geerbt-gekauft-geraubt.mdx` | `In 2018 the Historisches Museum Frankfurt showed its provenance research on paintings and silver, tracing how museums acquired objects under National Socialism.` |
| `projects/fr/geerbt-gekauft-geraubt.mdx` | `En 2018, le Musée historique de Francfort a présenté sa recherche de provenance sur peintures et argenterie : l'acquisition d'objets sous le national-socialisme.` |
| `projects/en/notaufnahmelager-giessen.mdx` | `Exhibition project at the Notaufnahmelager Gießen learning and remembrance site on migration histories, from displaced persons to asylum seekers worldwide.` |
| `projects/fr/notaufnahmelager-giessen.mdx` | `Projet d'exposition au lieu de mémoire du camp d'accueil de Giessen : histoires de migration, des expulsés aux demandeurs d'asile du monde entier.` |
| `projects/en/wir-sind-jetzt.mdx` | `Jewish Museum Frankfurt: everyday objects, paintings, photos and letters from Anne Frank's ancestors and family in the new permanent exhibition.` |
| `projects/fr/wir-sind-jetzt.mdx` | `Musée juif de Francfort : objets du quotidien, peintures, photos et lettres des ancêtres et de la famille d'Anne Frank dans l'exposition permanente.` |
| `projects/en/nachgefragt.mdx` | `Exhibition at the Young Museum Frankfurt (2021–2024) that introduced families with children to National Socialism in an age-appropriate way.` |
| `projects/fr/nachgefragt.mdx` | `Exposition du Jeune Musée de Francfort (2021–2024) qui initiait les familles avec enfants au national-socialisme de manière adaptée à l'âge.` |

**Rules (`AGENTS.md`):** German is the source; "Human translations already in the repo beat
machine output: when restructuring an `en`/`fr` page, keep its existing prose and only translate
what is genuinely new." Therefore:
- Build each en/fr description from **that page's own existing wording**: its `excerpt:` (projects)
  or `intro:` (pages) in the same file, shortened at a **real** sentence boundary. Do not run
  anything through a translator and do not write new claims.
- The sentences in the table above were condensed from those existing excerpts. Before using one,
  check that every fact in it (years, names, places) also appears in that page's `excerpt:`/`intro:`
  or body; if a fact does not, drop that fact and keep the rest.
- They are metadata, not page prose: do **not** change any page body, `excerpt` or `title`.
- The German `nachgefragt`, `geerbt`, `wir-sind-jetzt` and `notaufnahmelager-giessen` pages have
  complete descriptions already and are out of scope.

### C. The trailer

- The three `nachgefragt.mdx` pages each contain, at the end:
  ```mdx
  <video controls preload="none" poster="/media/nachgefragt-trailer-poster.jpg" style={{ inlineSize: '100%', blockSize: 'auto', borderRadius: 'var(--radius-m)' }}>
    <source src="/media/nachgefragt-trailer.mp4" type="video/mp4" />
  </video>
  ```
  at `src/content/projects/de/nachgefragt.mdx:35-37` and `…/en/nachgefragt.mdx:23-25`,
  `…/fr/nachgefragt.mdx:23-25`. There is no `<track>`.
- The video file lives **only in R2** (bucket `rahlwes-media`, key `nachgefragt-trailer.mp4`),
  served by `serveMedia()` in `src/worker.ts` under `/media/<key>`. The **poster** is a static
  asset in `public/media/`. Anything added to `public/media/` would be a static file; anything
  uploaded to R2 is served by the Worker with range support.
- Captions exist on YouTube for video id `qTRY0nZ8spM` in `de-DE` and `en` (3,464 and 3,028
  bytes). They were fetched with:
  `uvx yt-dlp --skip-download --write-subs --sub-langs "de-DE,en" --sub-format vtt -o trailer "https://www.youtube.com/watch?v=qTRY0nZ8spM"`
  → `trailer.de-DE.vtt`, `trailer.en.vtt`. French captions **do not exist**.
- The German file starts:
  ```
  WEBVTT
  Kind: captions
  Language: de-DE

  00:00:08.190 --> 00:00:11.130
  Die neue Ausstellung des Jungen Museums&nbsp;
  ```
  Two things to know about this file. (1) Cue lines end in `&nbsp;` entities, a YouTube
  artefact. WebVTT decodes `&nbsp;` to a non-breaking space, so a caption would carry
  stray trailing spaces and wrap badly; strip them in step 3. (2) The first cue starts at
  8 s, so the first 8 seconds are uncaptioned. That is the video's title card; leave it.
- **The `<track>` element must live inside `<video>` and be served same-origin** (it is:
  `/media/…`). A cross-origin track needs CORS headers; same-origin does not.
- `src/content.config.ts` / MDX: raw HTML in MDX is already used for `<video>`, so adding a
  `<track … />` self-closing element is valid MDX.
- Conventions: comments explain **why**; no machine translation of French captions (none
  exist; the French page uses the German captions with `srclang="de"`, which is correct
  because the **audio** is German, and a French reader gets a German-language caption
  track rather than none).

## Commands you will need

| Purpose   | Command                                         | Expected on success             |
|-----------|-------------------------------------------------|---------------------------------|
| Build     | `npm run build`                                 | exit 0                          |
| Typecheck | `npm run check` | `0 errors` (plan 001 adds it; before it lands, `npx astro check`) |
| Tests     | `npm test`                                      | 56 passed, 9 skipped (59 after plan 005) |
| Fetch captions | the `uvx yt-dlp …` command above, in a scratch dir outside the repo | two `.vtt` files |
| Upload to R2 | `npx wrangler r2 object put rahlwes-media/<key> --file <file> --content-type "text/vtt; charset=utf-8" --remote` | `Upload complete.` |
| Deploy    | `npm run deploy`                                | prints `Current Version ID:`    |

## Scope

**In scope** (the only files you should modify):
- The 11 frontmatter files in the table in section B (the `seo.description` line only)
- `src/content/projects/de/nachgefragt.mdx`, `…/en/nachgefragt.mdx`, `…/fr/nachgefragt.mdx`
  (add the `<track>` elements)
- R2 object uploads (not repository files): `nachgefragt-captions.de.vtt`,
  `nachgefragt-captions.en.vtt`

**Out of scope** (do NOT touch):
- Any page **body** text, any `excerpt`, `title`, `intro`
- `datenschutz.mdx`, `impressum.mdx`
- `src/worker.ts` and `wrangler.jsonc`
- Re-uploading or changing `nachgefragt-trailer.mp4`
- Machine-translating captions into French

## Git workflow

- Branch: `advisor/006-descriptions-captions`
- Two commits: descriptions, then captions. Style: short, imperative, no prefix, no
  attribution lines (example: `Fix the review findings and replace the template OG image`).
- Do NOT push or deploy unless the operator instructed it. Do NOT upload to R2 until the
  operator has confirmed the rights question (see Step 5).

## Steps

### Step 1: Replace the descriptions

For each row in section B, replace only the value on the `seo.description` line, keeping the
quotes and the two-space YAML indent exactly. Use straight quotes around the YAML string; an
apostrophe inside needs no escaping in a double-quoted YAML string, a double quote would.
None of the new values contains a double quote.

**Verify**:
- `grep -rn -E 'description: ".*(…|\.\.\.)"\s*$' src/content/pages src/content/projects src/content/journal`
  → matches only `datenschutz.mdx` and `impressum.mdx` (the two out-of-scope legal pages).
- For each edited file: `awk -F'description: ' '/seo:/{f=1} f && /description:/ {print length($2)-2; exit}' <file>` → a number ≤ 165.
- `npm run build` → exit 0 (the YAML still parses).

### Step 2: Commit the descriptions

One commit: `Complete the meta descriptions that the import had cut off`.

### Step 3: Fetch and clean the captions (scratch directory, not the repo)

Run the `yt-dlp` command from "Current state" in `/tmp/captions-nachgefragt/`. Then clean each
`.vtt`:

1. delete every `&nbsp;` (and the space before a line break it leaves),
2. keep `WEBVTT`, `Kind`, `Language`, all cue timings and all words **unchanged**,
3. do not re-time, merge or reword any cue.

Save as `nachgefragt-captions.de.vtt` and `nachgefragt-captions.en.vtt`.

**Verify**:
- `grep -c '&nbsp;' /tmp/captions-nachgefragt/*.vtt` → `0` for both.
- `grep -c -- '-->' /tmp/captions-nachgefragt/nachgefragt-captions.de.vtt` → equals the
  count in the unedited `trailer.de-DE.vtt` (the cue count must not change). Same for `en`.
- `head -3 …de.vtt` → starts with `WEBVTT`.

### Step 4: Keep the `<track>` elements out of `main` until the files are in R2

The markup is **not** in the three `nachgefragt.mdx` files on `main`: a deploy from `main` must never
ship caption requests whose files are not in R2 (they 404). It is saved as
`plans/006-track-markup.patch` (the exact diff of commit `e0518ef`, which was reverted), and it
adds, inside each `<video>` after `<source …/>`:

```mdx
  <track kind="captions" src="/media/nachgefragt-captions.de.vtt" srclang="de" label="Deutsch" default />
  <track kind="captions" src="/media/nachgefragt-captions.en.vtt" srclang="en" label="English" />
```

`default` goes on the **German** track on every language page: the audio is German, so German
captions are what the visitor needs first; a reader of the English page can switch to the English
track in the player's captions menu. Do not translate the labels.

**Verify**: `git apply --check plans/006-track-markup.patch` → exit 0 (the patch still applies).
Do not apply it yet.

### Step 5: Rights check, then upload, apply the patch and deploy in one go (operator gate)

**Stop here and ask the operator**: "The captions are Historisches Museum Frankfurt's work, like
the video. Have you confirmed permission to host them?" If **no**, do nothing: `main` stays
deployable. If **yes**, in this order, so no deploy ever sees markup without files:

```sh
npx wrangler r2 object put rahlwes-media/nachgefragt-captions.de.vtt --file /tmp/captions-nachgefragt/nachgefragt-captions.de.vtt --content-type "text/vtt; charset=utf-8" --remote
npx wrangler r2 object put rahlwes-media/nachgefragt-captions.en.vtt --file /tmp/captions-nachgefragt/nachgefragt-captions.en.vtt --content-type "text/vtt; charset=utf-8" --remote
git apply plans/006-track-markup.patch
npm run deploy
```

Then commit the applied markup. If `/tmp/captions-nachgefragt/` is gone, regenerate the two files
with step 3 first; the cue counts must be 31 each.

**Verify** against the deployed worker:
- `curl -s -D - -o /dev/null https://next.rahlwes.eu/media/nachgefragt-captions.de.vtt | grep -iE '^HTTP|content-type'` → `200`, `text/vtt; charset=utf-8`.
- `curl -s https://next.rahlwes.eu/media/nachgefragt-captions.de.vtt | head -c 60` → begins `WEBVTT`.
- `curl -s https://next.rahlwes.eu/projekte/nachgefragt/ | grep -c '<track'` → `2`.
- In a real browser, open `/projekte/nachgefragt/`, play the video, and confirm the captions
  button appears and German captions render. If you cannot open a browser, report that this
  check is pending.

## Test plan

Content and a media object only; there is no logic to unit-test. Verification is the
greps in Step 1 and 3, the build, and the deployed checks in Step 5. Do not add tests.

## Done criteria

- [ ] `grep -rn -E 'description: ".*(…|\.\.\.)"\s*$' src/content/pages src/content/projects src/content/journal` matches only the two legal pages
- [ ] Every edited description is ≤ 165 characters
- [ ] `npm run build` exits 0; `npm test` unchanged
- [ ] Until approval: `grep -c '<track' src/content/projects/{de,en,fr}/nachgefragt.mdx` is `0` for each and the patch passes `git apply --check`
- [ ] After approval: each page has exactly two `<track` elements, both `.vtt` objects are in R2 and `curl` returns `200`, `text/vtt`
- [ ] No `&nbsp;` in the uploaded captions
- [ ] `git status` shows only in-scope files changed
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The frontmatter in any file differs from the "current value" in the table (someone already fixed it).
- `yt-dlp` returns no `de-DE` caption track for `qTRY0nZ8spM`.
- The cue count changes during cleaning.
- The operator has **not** confirmed the rights question: do not upload.
- You are about to translate captions into French, edit a page body, run `npm run translate`, or
  re-run an importer script (that would re-introduce the cut: see the root cause in "Current state").
- A description would exceed 165 characters after you adjust it: shorten the sentence, do not
  drop meaning, and tell the operator the final wording.

## Maintenance notes

- A future importer or a Keystatic edit can reintroduce cut-off descriptions. A quick check
  to run before launch: the `grep` in Step 1's **Verify** (it is in the cutover checklist, plan 007).
- If the trailer is replaced, the caption files must be replaced with it, and under **new keys**
  (the media route sets `immutable` for a year).
- French captions are not provided; commissioning them needs the museum's permission.
- A reviewer should check that no description claims anything the page does not say.
