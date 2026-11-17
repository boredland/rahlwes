# Plan 003: Make a second dispatch of the same newsletter impossible on the server

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 14c7500..HEAD -- src/pages/api/admin/newsletter/dispatch.ts src/pages/admin/newsletter/index.astro src/newsletter/db.ts migrations REDAKTION.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED (adds a D1 migration to the live database)
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `14c7500`, 2026-11-17

## Why this matters

Sending a newsletter is irreversible and goes to every confirmed subscriber.
`POST /api/admin/newsletter/dispatch` checks only that the newsletter's `status` is
`ready`. That status lives in the content repository, and the only thing that changes it
to `sent` is an editor doing so by hand after the send. A double click is stopped by a
client-side `button.disabled`, but a second browser tab, a second editor, a page reload
or a replayed request all dispatch the **whole list again**. Duplicate bulk mail to real
people is a reputation and GDPR-trust problem on the sending domain
`marketing.rahlwes.eu`. After this plan, the database itself refuses a second campaign
for the same newsletter, so the guard cannot be bypassed from any client.

## Current state

- `src/pages/api/admin/newsletter/dispatch.ts` (122 lines) — queues one message per
  confirmed subscriber. Lines 56-75 and 96-104:
  ```ts
  if (!slug || !isLocale(locale)) { … 400 … }

  const entry = await getEntry('newsletters', `${locale}/${slug}`)
  if (!entry) return Response.json({ ok: false, message: 'Newsletter nicht gefunden.' }, { status: 404 })

  // Sending is irreversible, so the status has to be an explicit decision in the
  // editor rather than something a stray click here can override.
  if (entry.data.status !== 'ready') {
    return Response.json({ ok: false, message: 'Dieser Newsletter ist nicht als „Bereit zum Versand“ markiert.' }, { status: 409 })
  }
  …
  const campaign = await env.NEWSLETTER_DB.prepare(
    'INSERT INTO campaigns (slug, locale, subject, html, text) VALUES (?, ?, ?, ?, ?) RETURNING id',
  )
    .bind(slug, locale, entry.data.subject, html, text)
    .first<{ id: number }>()

  if (!campaign) {
    return Response.json({ ok: false, message: 'Kampagne konnte nicht angelegt werden.' }, { status: 500 })
  }
  ```
  Nothing checks whether a campaign for this `(slug, locale)` already exists.
- `migrations/0002_campaigns.sql` — the schema. `campaigns` has **no** uniqueness:
  ```sql
  CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL,
    locale TEXT NOT NULL,
    subject TEXT NOT NULL,
    html TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  ```
  `campaign_sends` has `PRIMARY KEY (campaign_id, subscriber_id)`, which stops duplicate
  sends **within one campaign** but not a second campaign.
- Migrations present: `0001_subscribers.sql` … `0006_confirmation_sent_at.sql`, applied
  remotely (`npx wrangler d1 migrations list rahlwes-newsletter --remote` says
  "No migrations to apply!"). The remote tables are **empty**: 0 campaigns, 0 sends,
  0 subscribers, and no `(slug, locale)` duplicates. A unique index therefore applies cleanly.
  Migration style: see `migrations/0006_confirmation_sent_at.sql` and
  `migrations/0003_bounces.sql` (read them and match: leading comment explaining why).
- `src/pages/admin/newsletter/index.astro` lines 97-120 — the UI: `confirm()` then
  `button.disabled = true`, re-enabled only on failure. It reads `entry.data.status` for
  the label and the `disabled` attribute (lines 59, 70). Its status labels (lines 24-28):
  `draft: 'Entwurf', ready: 'Bereit zum Versand', sent: 'Versendet'`.
- `REDAKTION.md:137-143` documents the editor workflow, in German. Lines 137-139 say to
  set the status to *Versendet* by hand after sending. **Lines 141-143 state the bug as
  advice**: "Ein zweiter Klick auf *Versenden* verschickt den Newsletter erneut an alle –
  also nur einmal klicken." After this plan that sentence is false and must be replaced.
- Conventions: D1 access is via `env.NEWSLETTER_DB.prepare(...).bind(...)`; user-facing
  admin strings are German only (`/admin/*` is internal). Errors return
  `Response.json({ ok: false, message }, { status })`.
- The remote database is live. **Applying a migration is a production change.** The
  operator applies it, not you (see Step 2).

## Commands you will need

| Purpose        | Command                                                                 | Expected on success             |
|----------------|-------------------------------------------------------------------------|---------------------------------|
| Typecheck      | `npm run check`                                                         | `0 errors` (plan 001 adds it; before it lands, `npx astro check`, which needs `@astrojs/check` and `typescript`) |
| Tests          | `npm test`                                                              | 56 passed, 9 skipped            |
| Build          | `npm run build`                                                         | exit 0                          |
| List migrations| `npx wrangler d1 migrations list rahlwes-newsletter --remote`           | lists pending migrations        |
| Apply (local)  | `npx wrangler d1 migrations apply rahlwes-newsletter --local`           | applies to the local sim        |
| Apply (remote) | `npx wrangler d1 migrations apply rahlwes-newsletter --remote`          | **operator only**               |
| Query remote   | `npx wrangler d1 execute rahlwes-newsletter --remote --command "SELECT …"` | rows                         |

## Scope

**In scope** (the only files you should modify):
- `migrations/0007_campaign_uniqueness.sql` (create)
- `src/pages/api/admin/newsletter/dispatch.ts`
- `src/pages/admin/newsletter/index.astro` — only to show "already sent" state
- `REDAKTION.md` — only the last paragraph of "Versenden" (lines 141-143)

**Out of scope** (do NOT touch):
- `src/worker.ts` (the queue consumer's per-recipient idempotency is correct and decided)
- Existing migrations `0001`–`0006` (never edit an applied migration)
- `keystatic.config.ts` and the `status` field semantics
- Any change to who receives mail or to the unsubscribe flow

## Git workflow

- Branch: `advisor/003-resend-guard`
- Commit per step; style: short, imperative, no prefix, no attribution lines.
- Do NOT push, deploy, or apply the **remote** migration unless the operator instructed it.

## Steps

### Step 1: Write the migration

Create `migrations/0007_campaign_uniqueness.sql`:

```sql
-- One campaign per newsletter and language.
--
-- Dispatch trusts the `status` in the content repository, which is only flipped to
-- "sent" by hand afterwards, so a second tab or a replayed request could mail the whole
-- list again. A unique index makes the database the arbiter: the second INSERT fails
-- and dispatch reports it, whichever client sent the request.
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_slug_locale ON campaigns (slug, locale);
```

Pattern: match the leading-comment style of `migrations/0003_bounces.sql`.

**Verify (local only)**: `npx wrangler d1 migrations apply rahlwes-newsletter --local` →
reports 0007 applied with no error. Then
`npx wrangler d1 execute rahlwes-newsletter --local --command "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_campaigns_slug_locale'"`
→ returns one row.

### Step 2: Ask the operator to apply it remotely

Do **not** run the remote migration yourself. Stop after step 1's local check, report that
`0007` is ready, and state: "Run `npx wrangler d1 migrations apply rahlwes-newsletter --remote`
before deploying the code in step 3. The remote `campaigns` table is empty, so the index
applies cleanly." Continue with steps 3-4 (code only) while waiting, but do not deploy
until the operator confirms.

### Step 3: Turn the constraint into a clear refusal in `dispatch.ts`

Two changes in `dispatch.ts`:

(a) Check **before** rendering, so a repeat request is refused cheaply. After the
`status !== 'ready'` check and before `listVerified`, add:

```ts
// The unique index on (slug, locale) is the real guard; this read only turns the
// common case into a readable answer before any rendering or queueing work.
const already = await env.NEWSLETTER_DB.prepare('SELECT id FROM campaigns WHERE slug = ? AND locale = ?')
  .bind(slug, locale)
  .first<{ id: number }>()
if (already) {
  return Response.json(
    { ok: false, message: 'Dieser Newsletter wurde bereits versendet. Ein erneuter Versand ist gesperrt.' },
    { status: 409 },
  )
}
```

(b) The check-then-insert is not atomic: two simultaneous requests can both pass (a).
Wrap the `INSERT INTO campaigns` in a `try`/`catch` and map a unique-constraint failure to
the same 409. D1 reports it as an error whose message contains `UNIQUE constraint failed`:

```ts
let campaign: { id: number } | null
try {
  campaign = await env.NEWSLETTER_DB.prepare(
    'INSERT INTO campaigns (slug, locale, subject, html, text) VALUES (?, ?, ?, ?, ?) RETURNING id',
  )
    .bind(slug, locale, entry.data.subject, html, text)
    .first<{ id: number }>()
} catch (error) {
  if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
    return Response.json(
      { ok: false, message: 'Dieser Newsletter wurde bereits versendet. Ein erneuter Versand ist gesperrt.' },
      { status: 409 },
    )
  }
  throw error
}
```

Keep the existing `if (!campaign)` 500 branch after it.

**Verify**: `npm run check` → `0 errors`; `npm run build` → exit 0.

### Step 4: Reflect the state in the admin page and the editor guide

In `src/pages/admin/newsletter/index.astro`, load the set of already-dispatched
`(locale, slug)` pairs with one query next to the existing `listVerified` call
(`SELECT slug, locale FROM campaigns`), and:
- disable the button and show the label `Bereits versendet` for those rows,
- keep the existing `ready` and recipients checks.

In `REDAKTION.md` **replace lines 141-143** (the last paragraph of "Versenden"):

```
Die Mails werden in einer Warteschlange nacheinander verschickt; bei einer
größeren Liste dauert das ein paar Minuten. Ein zweiter Klick auf *Versenden*
verschickt den Newsletter erneut an alle – also nur einmal klicken.
```

with:

```
Die Mails werden in einer Warteschlange nacheinander verschickt; bei einer
größeren Liste dauert das ein paar Minuten. Ein Newsletter lässt sich pro Sprache nur
einmal versenden – ein zweiter Klick wird abgewiesen. Soll eine korrigierte Fassung
raus, den Eintrag in Keystatic unter einem **neuen Titel (neuer Slug)** kopieren.
```

Leave every other line of `REDAKTION.md` unchanged. (Lines 137-139, which tell editors to
set the status to *Versendet*, stay: that status is still the editors' own record.)

**Verify**: `npm run build` → exit 0; `grep -n "Bereits versendet" src/pages/admin/newsletter/index.astro` → a match.

### Step 5: Verify against the real worker (after the operator applied 0007 and approved a deploy)

Use a **throwaway newsletter** that exists as content with `status: ready`, and ensure the
subscriber list contains **only addresses you control** (never `@example.com`; they bounce
and hurt the domain). The remote list is currently empty, so add yourself through the
public signup and confirm via the mail link first. Then, with a valid admin cookie
(`keystatic-gh-access-token=$(gh auth token)`):

```sh
curl -s -X POST https://next.rahlwes.eu/api/admin/newsletter/dispatch \
  -H "cookie: keystatic-gh-access-token=$(gh auth token)" \
  -H 'origin: https://next.rahlwes.eu' -H 'content-type: application/json' \
  --data '{"slug":"<test-slug>","locale":"de"}'
```

First call → `{"ok":true,…,"queued":N}`. Repeat the identical call → HTTP `409` with the
"bereits versendet" message. Then:

```sh
npx wrangler d1 execute rahlwes-newsletter --remote --command "SELECT slug, locale, COUNT(*) FROM campaigns GROUP BY slug, locale"
```

→ exactly one row, count 1. **Delete the test campaign afterwards**, and only after the queue has
drained (all mails for it delivered or failed), checked with
`SELECT status, COUNT(*) FROM campaign_sends WHERE campaign_id = <id> GROUP BY status`
showing no `pending` or `sending` rows. Then `DELETE FROM campaigns WHERE slug = '<test-slug>'`
(rows in `campaign_sends` cascade). Deleting it earlier does not recall mail already queued.

**Verify**: the 200 then 409 sequence and the single campaign row. Record both.

## Test plan

No harness exists for `src/pages/api` (see plan 002). The behavioural proof is step 5
against the real database, plus the unique index itself, which a test could not improve on.
Do not add mocked tests for `dispatch.ts`.

## Done criteria

- [ ] `migrations/0007_campaign_uniqueness.sql` exists and applies locally
- [ ] After the operator applied it: `npx wrangler d1 migrations list rahlwes-newsletter --remote` reports nothing pending
- [ ] `npm run check` and `npm run build` pass; `npm test` unchanged (56 passed, 9 skipped)
- [ ] Second dispatch of the same `(slug, locale)` returns `409` on the deployed worker
- [ ] `git status` shows only in-scope files changed
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `SELECT slug, locale, COUNT(*) FROM campaigns GROUP BY slug, locale HAVING COUNT(*) > 1`
  returns rows on the remote database: the unique index cannot be created; report the rows.
- `campaigns` is no longer empty: tell the operator before they apply the migration.
- D1's error message for a unique violation does not contain `UNIQUE constraint failed`
  (step 3b would not match): report the actual message text.
- Step 5 would mail any address you do not control. Do not run it; report instead.
- You find yourself editing `worker.ts` or an old migration.

## Maintenance notes

- Consequence for editors: a corrected newsletter needs a **new slug**, not a re-send of
  the old one. This is intentional and now written in `REDAKTION.md`.
- A subscriber added after a send does not receive it; that is unchanged.
- **A dispatch that fails partway must not be "fixed" by deleting the campaign row.**
  `dispatch.ts` writes one `campaign_sends` row per subscriber first (lines 106-111), then queues
  in chunks of 100 (lines 117-119). If a `sendBatch` throws after earlier chunks were queued,
  those recipients are already being mailed. Deleting the `campaigns` row **cascades** to
  `campaign_sends`, and a fresh dispatch would then create a new campaign and mail everyone in
  the earlier chunks a second time, which is the exact outcome this plan prevents.
  Safe recovery keeps the campaign and requeues **only** the rows still owed mail:
  `SELECT subscriber_id FROM campaign_sends WHERE campaign_id = ? AND status IN ('pending', 'failed')`.
  The consumer already claims only those two statuses (`src/worker.ts:58`), so a requeue of
  that set cannot double-send. A requeue endpoint is **not** part of this plan: it is deliberate
  future work, and until it exists the operator requeues those rows by hand. Deleting the
  campaign row is safe only when
  `SELECT COUNT(*) FROM campaign_sends WHERE campaign_id = ? AND status != 'pending'`
  returns `0`, meaning nothing was claimed or sent.
- If per-subscriber re-send of a failed message is ever needed, use `campaign_sends.status`
  (`failed`), which the consumer already re-claims; do not remove the unique index.
