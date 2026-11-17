# Plan 001: Run typecheck, tests and the build on every push and pull request

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 14c7500..HEAD -- package.json package-lock.json tsconfig.json .github/workflows src/i18n/content.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `14c7500`, 2026-11-17

## Why this matters

Nothing in this repository checks a change before or after it lands on `main`.
The only workflows are a daily scraper and a daily upstream-drift test. A push
that breaks `npm run build`, fails a test, or introduces a type error is only
noticed when someone deploys by hand. The six plans that follow all need a command
that says "this change did not break anything"; this plan makes that command run
automatically. The type gate must be `astro check`, not plain `tsc`: `tsc` does not
read `.astro` files, and this site's layouts and components are `.astro` files.

## Current state

- `package.json:8-18` — scripts. There is **no** typecheck script:
  ```json
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "wrangler dev",
    "deploy": "astro build && wrangler deploy",
    "translate": "node --env-file=.env scripts/translate.mjs",
    "rephrase": "node --env-file=.env scripts/rephrase.mjs",
    "test": "vitest run",
    "test:drift": "DRIFT=1 vitest run test/ankai/drift.test.ts",
    "astro": "astro"
  },
  ```
- **`@astrojs/check` and `typescript` are installed locally but are NOT declared** in
  `package.json` (`npm ls @astrojs/check typescript --depth=0` marks both `extraneous`:
  `@astrojs/check@0.9.10`, `typescript@6.0.3`). A fresh `npm ci`, which is what CI runs,
  does **not** install undeclared packages, so `astro check` would fail in CI with a prompt
  to install them. Both must be added to `devDependencies` as part of this plan.
- `.github/workflows/` contains only `drift.yml` (daily 06:00 UTC, runs `npm run test:drift`)
  and `scrape-cfps.yml` (daily 05:00 UTC, commits `src/data/cfps.json`). Neither runs on
  `push` or `pull_request`. `drift.yml` is the exemplar to copy the setup steps from:
  ```yaml
  jobs:
    drift:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v5
        - uses: actions/setup-node@v5
          with:
            node-version: 22
        - run: npm ci
  ```
- `tsconfig.json` extends `astro/tsconfigs/strict`; path aliases for `@components`, `@i18n`,
  `@newsletter`, `@cfp`, `@ankai`, etc.
- **Type baseline, measured 2026-11-17 in the main tree after `astro sync`:**
  - `npx astro check` → exit 0, ~8 s, `Result (138 files): 0 errors, 0 warnings, 5 hints`.
    The 5 hints (not failures) are: `scripts/scrape-cfps.mjs:103` unused `IS_ROUNDUP`, and
    "may be converted to an async function" at `src/ankai/lib/gateway.ts:55`,
    `src/cfp/db.ts:55`, `src/newsletter/db.ts:58` and `:65`.
  - `npx tsc --noEmit -p .` → exit 0, no output.
  - **An earlier measurement reported one `tsc` error** at
    `src/i18n/content.ts(19,39): TS7031 Binding element 'id' implicitly has an 'any' type`.
    It did not reproduce after Astro's generated types (`.astro/content.d.ts`,
    `.astro/types.d.ts`) were refreshed. Those files are **git-ignored** (`.gitignore:3`
    lists `.astro/`), so on a **clean CI checkout** they do not exist until `astro sync` or a
    build generates them, and that error **may appear** there. Line 19 is:
    ```ts
    return getCollection(collection, ({ id }) => splitId(id).locale === locale)
    ```
    where `collection` is generic (`C extends LocalizedCollection`), which can defeat the
    inference of the filter callback's parameter when the generated types are stale or absent.
    Do not assume it is gone: **verify on a clean checkout** (step 1).
- `npm test` currently: 5 test files pass, 1 skipped (`test/ankai/drift.test.ts`), 56 tests
  pass, 9 skipped. Runtime ~1.3 s. It needs no network.
- `npm run build` passes **on the operator's machine** (exit 0, ~14 s) and prints one standing
  warning: `[glob-loader] No files found matching "*/*.mdx" in directory "src/content/newsletters"`.
  **It fails on a clean clone with no Cloudflare login** (verified 2026-11-17): `wrangler.jsonc`
  declares the email bindings with `"remote": true`, so the Cloudflare Vite plugin starts a
  remote proxy session during the build and aborts with "More than one account available but
  unable to select one in non-interactive mode". CI has no login, so the CI job must **not** run
  `npm run build`. Do not "fix" this by setting `account_id` or a token in the workflow.
- Node engine: `>=22.12.0` (`package.json` `engines`). CI uses Node 22.
- Conventions: workflow files use German step names, with English comments explaining
  **why** (see `drift.yml`). AGENTS.md: "Comments explain why, never what."
- `npm audit` reports 26 high advisories in production scope (mostly build and dev tooling).
  **Do not** make CI fail on `npm audit`; that is out of scope here.

## Commands you will need

| Purpose            | Command                              | Expected on success                          |
|--------------------|--------------------------------------|----------------------------------------------|
| Install            | `npm ci`                             | exit 0                                       |
| Generate types     | `npx astro sync`                     | exit 0                                       |
| Typecheck          | `npm run check`                      | exit 0, `0 errors` (after step 1-2)          |
| Tests              | `npm test`                           | exit 0, 56 passed, 9 skipped                 |
| Build              | `npm run build`                      | exit 0, ends with `Complete!`                |

## Scope

**In scope** (the only files you should modify):
- `package.json` and `package-lock.json` — declare `@astrojs/check` and `typescript`, add a `check` script
- `src/i18n/content.ts` — **only if** step 1 reproduces the TS7031 error
- `.github/workflows/check.yml` (create)
- `README.md` — one line in the Commands block

**Out of scope** (do NOT touch):
- `.github/workflows/drift.yml`, `.github/workflows/scrape-cfps.yml`
- Any test file, any other `src/` file
- `npm audit` findings and dependency upgrades beyond the two additions
- Adding ESLint, Prettier or a pre-commit hook

## Git workflow

- Branch: `advisor/001-ci-gate`
- One commit per step. Message style matches the repo, for example
  `Drift-Tests fuer die Archivquellen uebernehmen` or
  `Fix the review findings and replace the template OG image`: short, imperative, no prefix,
  no `Co-Authored-By` or attribution lines (AGENTS.md forbids them).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Measure the baseline on a clean checkout, not on this working tree

The working tree has generated `.astro/` types that CI will not have. Reproduce CI's state:

```sh
rm -rf /tmp/ci-sim && git clone --quiet . /tmp/ci-sim && cd /tmp/ci-sim
npm ci
npx astro sync
npx astro check
```

If `npx astro check` stops to ask to install `@astrojs/check` or `typescript`, answer **no** and
continue: that confirms step 2 is needed. Record the result of `astro check` **after** step 2
installs them, on this clean clone.

**Verify**: note whether `src/i18n/content.ts(19,39)` TS7031 appears. Then continue in step 2.

### Step 2: Declare the two packages and add the `check` script

```sh
npm install --save-dev @astrojs/check typescript
```

Use the versions already resolved locally if the install allows it (`@astrojs/check` 0.9.x,
`typescript` 6.x); do not upgrade anything else. In `package.json` `scripts`, add after `"test:drift"`:

```json
"check": "astro check",
```

(Do not name it `typecheck`; Astro's own docs and the `astro` CLI call this `check`, and the
name keeps the README consistent with upstream.)

**Verify**:
- `npm ls @astrojs/check typescript --depth=0` → both listed **without** `extraneous`.
- `git diff --stat package.json package-lock.json` → only those two files changed.
- On the clean clone from step 1 (pull your branch there or repeat the clone): `npm ci && npx astro sync && npm run check` → exit 0.

### Step 3: Fix the type error **only if it reproduced**

If step 1 or step 2 on the clean clone reports the TS7031 at `src/i18n/content.ts(19,39)`,
give the filter callback's parameter an explicit type:

```ts
return getCollection(collection, ({ id }: { id: string }) => splitId(id).locale === locale)
```

If that produces a **new** error (for example the overload expects `CollectionEntry<C>`), use
`(entry: { id: string })` and read `entry.id`. Do not use `any`, do not add `@ts-ignore`.

If the error did **not** reproduce on the clean clone, make **no** change to `content.ts` and say so
in your report.

**Verify**: on the clean clone, `npm run check` → exit 0 and `0 errors`. Then `npm run build` → exit 0.

### Step 4: Add the workflow

Create `.github/workflows/check.yml`:

```yaml
name: Prüfen

on:
  push:
    branches: [main]
  pull_request:

# Read-only: this job only looks. Anything that writes to the repository
# (scrape-cfps.yml) asks for its own permission.
permissions:
  contents: read

concurrency:
  group: check-${{ github.ref }}
  cancel-in-progress: true

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - uses: actions/setup-node@v5
        with:
          node-version: 22
          cache: npm

      - run: npm ci

      # .astro/ is git-ignored, so a fresh checkout has none of the generated content
      # types that the checker needs to resolve collections.
      - run: npx astro sync

      # Pushing to main does not deploy (npm run deploy does), so this is the only
      # automatic signal that a change still compiles. astro check, not plain tsc:
      # tsc does not read .astro files.
      - run: npm run check

      # Offline tests only. test:drift hits live archives and has its own workflow.
      - run: npm test

      # No `npm run build` here on purpose: wrangler.jsonc marks the email bindings
      # `remote: true`, so a build starts a remote proxy session that needs a Cloudflare
      # login, and this read-only job has no credentials. `npm run deploy` runs the
      # build with the operator's login.
```

`PUBLIC_CF_BEACON_TOKEN` and other `.env` values are **not** set in CI, which is fine: an unset
beacon token renders no beacon (README "Analytics"). Do not add secrets to this workflow.

**Verify**: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/check.yml')); print('ok')"` → `ok`.
If python's `yaml` is unavailable, rely on step 6.

### Step 5: Document the command

In `README.md`, in the `## Commands` code block, add one line between `npm run deploy` and
`npm run translate`:

```
npm run check      # astro check (types incl. .astro files); CI also runs the tests on every push
```

**Verify**: `sed -n '24,38p' README.md` shows the new line inside the block, which is otherwise unchanged.

### Step 6: Run the exact CI sequence on a clean clone

```sh
rm -rf /tmp/ci-sim && git clone --quiet . /tmp/ci-sim && cd /tmp/ci-sim
git checkout advisor/001-ci-gate   # or fetch your branch into the clone
npm ci && npx astro sync && npm run check && npm test
```

**Verify**: every command exits 0; `npm run check` prints `0 errors`; `npm test` reports
`56 passed | 9 skipped`. Delete `/tmp/ci-sim` afterwards.

## Test plan

No new tests: this plan adds a gate, not behaviour. The gate's own correctness is checked by step 6
on a clean clone, and by the first GitHub Actions run after the operator pushes.

## Done criteria

- [ ] On a **clean clone**: `npm ci && npx astro sync && npm run check` exits 0 with `0 errors`
- [ ] `npm ls @astrojs/check typescript --depth=0` shows both **without** `extraneous`
- [ ] `npm test` exits 0 (56 passed, 9 skipped)
- [ ] `.github/workflows/check.yml` does **not** contain `npm run build`
- [ ] `.github/workflows/check.yml` exists, triggers on `push` to `main` and on `pull_request`, and runs `astro sync` before `npm run check`
- [ ] `git status` shows only the in-scope files changed (`content.ts` only if the error reproduced)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- On the clean clone, `astro check` reports an error **other than** the `TS7031` at
  `src/i18n/content.ts(19,39)`, or more than one error: the baseline has drifted.
- Fixing `content.ts` needs `any`, `@ts-ignore` or a cast through `unknown`.
- `npm install --save-dev @astrojs/check typescript` upgrades or changes any other package in
  `package-lock.json` (look at `git diff --stat package-lock.json`; a large diff is a STOP).
- `npm test` no longer reports 56 passed / 9 skipped on `main` before your change.
- You are about to add credentials, `account_id` or a Cloudflare token to the workflow to make
  the build run in CI.
- You are tempted to add `npm audit`, lint or format steps: they are out of scope.

## Maintenance notes

- The workflow deliberately does not deploy. Deploying stays `npm run deploy` by hand
  (README "Analytics": a bare `wrangler deploy` once dropped the analytics beacon).
- `astro check` currently prints 5 **hints** (an unused `IS_ROUNDUP` and four "may be converted to
  an async function"); they do not fail the run. If you later want a stricter gate, fix them first.
- If a future plan adds worker tests that need a Workers runtime pool, the `npm test` step is
  where it would run; `vitest.config.ts` uses the plain Node pool today.
- A reviewer should check that the workflow has `permissions: contents: read` and no secrets, so a
  pull request from a fork cannot reach credentials, and that `astro sync` runs before `astro check`.
- Deferred on purpose: failing CI on `npm audit` (26 high advisories, mostly build-time), and a
  lint step (none configured).
