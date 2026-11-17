# Plan 002: Make the contact form refuse submissions it cannot verify, and reject malformed JSON with a 400

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 14c7500..HEAD -- src/pages/api/kontakt.ts src/pages/api/newsletter/subscribe.ts src/components/ContactForm.astro .env.example wrangler.jsonc`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED (fails closed: the form stops working until the Turnstile widget and secret exist)
- **Depends on**: none (001 recommended first so the change is checked by CI). **Operator prerequisite before any deploy: step 0.**
- **Category**: security
- **Planned at**: commit `14c7500`, 2026-11-17

## Why this matters

The contact endpoint verifies a Cloudflare Turnstile token only when a secret named
`TURNSTILE_SECRET_KEY` exists. On the deployed worker (`next.rahlwes.eu`) that secret
**is not set** (verified with `npx wrangler secret list`: no Turnstile entry) and the page
renders no Turnstile widget. So today the endpoint accepts any submission, and every
accepted submission sends a confirmation mail **to the address the submitter typed**,
from the transactional domain `send.rahlwes.eu`, quoting up to 5000 characters of
text the submitter wrote. Anyone can use the site to send a message of their choosing
to any victim. The only brake is a per-IP rate limit of 5 requests per 60 s, which
rotating IPs defeats. Spam complaints would damage `send.rahlwes.eu`, the domain that
carries her real contact replies. Separately, a JSON body of `null` or a non-string
field makes both public form endpoints answer `500` instead of `400`.

## Current state

- `src/pages/api/kontakt.ts` — the contact endpoint (221 lines).
  - Lines 85-100, Turnstile verification, with no timeout and an unguarded `.json()`:
    ```ts
    async function verifyTurnstile(token: string | undefined, secret: string, ip: string | null) {
      if (!token) return false

      const body = new FormData()
      body.append('secret', secret)
      body.append('response', token)
      if (ip) body.append('remoteip', ip)

      const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body,
      })
      const outcome = (await response.json()) as { success: boolean; 'error-codes'?: string[] }
      if (!outcome.success) console.warn('turnstile rejected', outcome['error-codes'])
      return outcome.success
    }
    ```
  - Lines 102-112, payload parsing — a body of `null` parses fine and `payload.locale` then throws:
    ```ts
    export const POST: APIRoute = async ({ request, clientAddress }) => {
      let payload: ContactPayload

      try {
        payload = (await request.json()) as ContactPayload
      } catch {
        return Response.json({ ok: false, message: replies.de.invalid }, { status: 400 })
      }

      const locale = currentLocale(payload.locale)
    ```
  - Lines 126-129 call `.trim()` on fields that are only *typed* as strings:
    ```ts
    const fname = (payload.fname ?? '').trim().slice(0, LIMITS.name)
    ```
    A numeric `fname` makes `.trim` undefined and throws.
  - Lines 138-144, the fail-open branch:
    ```ts
    // Optional so the form still works before the widget exists; once the secret is
    // set every submission must pass verification.
    const secret = (env as Env & { TURNSTILE_SECRET_KEY?: string }).TURNSTILE_SECRET_KEY
    if (secret) {
      const ok = await verifyTurnstile(payload['cf-turnstile-response'], secret, clientAddress ?? null)
      if (!ok) return Response.json({ ok: false, message: t.captcha }, { status: 403 })
    }
    ```
  - Lines 184-198, the confirmation mail to the submitter echoes `${message}` in both
    the text and HTML parts.
  - The `replies` table (lines 29-54) already has a `captcha` string in de, en and fr.
- `src/pages/api/newsletter/subscribe.ts` lines 19-26 and 43: same pattern
  (`payload = (await request.json()) as SubscribePayload`, then
  `normalizeEmail(payload.email ?? '')`, which calls `.trim()` and throws for a number).
- `src/components/ContactForm.astro` lines 21-22 and 71, 80: the widget renders only
  when `import.meta.env.PUBLIC_TURNSTILE_SITEKEY` is non-empty. That variable is read at
  **build time** and inlined into the page, exactly like `PUBLIC_CF_BEACON_TOKEN`
  (`README.md` "Analytics": a deploy without a rebuild ships whatever `dist/` holds):
  ```ts
  // Empty in dev until the widget exists; the endpoint then skips verification.
  const sitekey = import.meta.env.PUBLIC_TURNSTILE_SITEKEY ?? ''
  ```
- `src/pages/api/cfps/notify.ts` lines 25-30 is the **exemplar** for "refuse while the
  secret is unset":
  ```ts
  const { CFP_WEBHOOK_SECRET: secret } = env as Env & { CFP_WEBHOOK_SECRET?: string }
  if (!secret) {
    console.error('CFP_WEBHOOK_SECRET is not set; refusing to accept a digest')
    return Response.json({ ok: false, message: 'Not configured.' }, { status: 503 })
  }
  ```
  Match that shape (status 503, `console.error` naming the missing secret).
- `.env.example` does **not** mention `TURNSTILE_SECRET_KEY` or `PUBLIC_TURNSTILE_SITEKEY`
  (verified: no match). Its style is a `#` comment block per secret, ending in the empty
  assignment, e.g. the `CFP_WEBHOOK_SECRET` block (lines 47-58).
- `PUBLIC_` prefix rule: Astro exposes only `PUBLIC_*` variables to client code
  (`.env.example` lines 86-89). The sitekey is public by design; the secret key is a
  Worker secret set with `npx wrangler secret put`.
- Local development: `npm run dev` has no real widget. Do **not** add an "unset means skip" branch
  for it. Instead use Cloudflare's published **always-pass test keys**, which work on
  `localhost` and any domain (Cloudflare docs, "Test your Turnstile implementation"):
  test sitekey `1x00000000000000000000AA` and test secret
  `1x0000000000000000000000000000000AA`. The test sitekey makes the widget emit the dummy
  token `XXXX.DUMMY.TOKEN.XXXX`, which **only** the test secret accepts, and a **production**
  secret rejects it. So the two keys must be used as a pair, and **never** the test secret on
  the deployed worker (it would let anyone in).
- Conventions: user-facing strings exist in de, en and fr (AGENTS.md: "A missing key is a
  type error by design"); comments explain **why**; `satisfies Record<Locale, …>` for
  per-language tables. Do not add a fourth language or inline-translate: reuse existing
  `replies.*.captcha` and `replies.*.invalid`.
- There are **no tests** for any `src/pages/api` file and the vitest config
  (`vitest.config.ts`) only aliases `@ankai`. Verification for this plan is `curl`
  against a deployed worker (see Steps), matching AGENTS.md: "a change to anything under
  `src/newsletter/`, `src/pages/api/` or `src/worker.ts` is unverified until it has run
  on `next.rahlwes.eu`."
- **Never send test mail to `@example.com`** (AGENTS.md: they bounce and hurt the sending
  domain; 41 `deliveryFailed` events already exist). Every curl in this plan is designed to
  be rejected **before** any mail is sent. Do not submit a form that would reach `EMAIL.send`.

## Commands you will need

| Purpose   | Command                                   | Expected on success                |
|-----------|-------------------------------------------|------------------------------------|
| Typecheck | `npm run check`                           | exit 0, `0 errors` (needs plan 001; before it lands, `npx astro check`, which needs `@astrojs/check` and `typescript`) |
| Tests     | `npm test`                                | 56 passed, 9 skipped               |
| Build     | `npm run build`                           | exit 0                             |
| Deploy    | `npm run deploy`                          | prints `Current Version ID:`       |
| Secrets   | `npx wrangler secret list`                | JSON array of secret names         |

## Scope

**In scope** (the only files you should modify):
- `src/pages/api/kontakt.ts`
- `src/pages/api/newsletter/subscribe.ts`
- `.env.example`
- `README.md` — one short subsection (see step 5)

**Out of scope** (do NOT touch):
- `src/components/ContactForm.astro`, `src/components/NewsletterForm.astro`: the widget
  wiring is correct; do **not** add Turnstile to the newsletter form (a separate decision,
  recorded in `wrangler.jsonc:29-31`).
- `src/newsletter/enroll.ts` and any DB code.
- The wording of the consent checkboxes and the confirmation mail body (AGENTS.md:
  consent text is legally load-bearing; do not "tighten" it).
- `wrangler.jsonc` (the rate limiter stays as is).

## Git workflow

- Branch: `advisor/002-contact-fail-closed`
- One commit per logical unit; message style matches the repo (short, imperative,
  no prefix, no attribution lines).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 0: Operator prerequisite, before **any** deploy of this plan

Failing closed means the form is **down** on the deployed site until a real Turnstile widget and
secret exist. Staging has neither today (`npx wrangler secret list` shows no Turnstile entry;
the page renders no widget). Deploying this plan first would take the contact form offline. So
the operator does this **first**, and the executor must confirm it before deploying:

1. In the Cloudflare dashboard create a Turnstile widget for hostname `next.rahlwes.eu`
   (add `rahlwes.eu` later, at cutover). Copy its **sitekey** and **secret key**. Do not paste
   either into chat, a commit or a plan.
2. `npx wrangler secret put TURNSTILE_SECRET_KEY` and paste the secret at the prompt.
3. Put the sitekey in the local `.env` as `PUBLIC_TURNSTILE_SITEKEY=<sitekey>`. It is read at
   **build** time, so the next `npm run deploy` inlines it; a deploy from a machine whose `.env`
   lacks it ships a form **without** the widget (the same trap as the analytics beacon).

**Verify** (executor): `npx wrangler secret list` includes the name `TURNSTILE_SECRET_KEY`, and
`grep -c '^PUBLIC_TURNSTILE_SITEKEY=.\+' .env` prints `1`. (Both only name/count; never print a value.)
If either is missing: **STOP** (see STOP conditions); do not deploy.

### Step 1: Add one shared body reader to each route

Both routes already parse JSON inside a `try`. Replace the cast with a check that the
body is a plain object whose used fields are strings, returning the existing 400 reply on
any other shape. Add this helper **inside each file** (do not create a shared module;
two call sites do not justify one):

```ts
/** A body that is not an object, or whose text fields are not strings, is a malformed request, not a server error. */
function asStrings<T extends Record<string, unknown>>(value: unknown, keys: (keyof T)[]): value is T {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return keys.every((key) => record[key as string] === undefined || typeof record[key as string] === 'string')
}
```

In `kontakt.ts` after parsing, require
`asStrings<ContactPayload>(parsed, ['fname','lname','email','message','locale','website','cf-turnstile-response'])`
and return `Response.json({ ok: false, message: replies.de.invalid }, { status: 400 })`
when it is false. In `subscribe.ts` require
`asStrings<SubscribePayload>(parsed, ['email','locale','website'])` and return
`newsletterCopy('de').signup.invalid` with status 400.

Keep the booleans (`consent`, `newsletter`) read exactly as today (`payload.consent`,
`payload.newsletter`): truthiness is the existing behaviour and is not a crash risk.

**Verify**: `npm run build` → exit 0. (Behavioural verification happens in step 6.)

### Step 2: Fail closed whenever the Turnstile secret is missing

In `kontakt.ts`, replace lines 138-144 with this logic. There is deliberately **no** "unset means
skip" branch and no `import.meta.env.PROD` test: a missing secret refuses the request everywhere,
and local development uses Cloudflare's test-key pair instead (step 4).

```ts
// A missing secret must stop the form rather than wave every submission through: the
// confirmation mail below would otherwise relay attacker-chosen text to any address.
const secret = (env as Env & { TURNSTILE_SECRET_KEY?: string }).TURNSTILE_SECRET_KEY
if (!secret) {
  console.error('TURNSTILE_SECRET_KEY is not set; refusing contact submissions')
  return Response.json({ ok: false, message: t.error }, { status: 503 })
}
const ok = await verifyTurnstile(payload['cf-turnstile-response'], secret, clientAddress ?? null)
if (!ok) return Response.json({ ok: false, message: t.captcha }, { status: 403 })
```

`t.error` already reads "…Bitte schreiben Sie mir direkt an info@rahlwes.eu." in German
and has en/fr equivalents, so a visitor still has a way to reach her.

**Verify**: `npm run check` → exit 0, `0 errors`.

### Step 3: Give `verifyTurnstile` a timeout and a safe JSON read

Change the `fetch` to carry `signal: AbortSignal.timeout(5000)` and wrap the whole
function body so a network error, a timeout or a non-JSON reply returns `false`
(the caller then answers 403 with `t.captcha`):

```ts
async function verifyTurnstile(token: string | undefined, secret: string, ip: string | null) {
  if (!token) return false

  const body = new FormData()
  body.append('secret', secret)
  body.append('response', token)
  if (ip) body.append('remoteip', ip)

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(5000),
    })
    const outcome = (await response.json()) as { success?: boolean; 'error-codes'?: string[] }
    if (!outcome.success) console.warn('turnstile rejected', outcome['error-codes'])
    return outcome.success === true
  } catch (error) {
    console.error('turnstile verification failed', error)
    return false
  }
}
```

**Verify**: `npm run check` → exit 0, `0 errors`.

### Step 4: Document the variables and the local test keys in `.env.example`

Append a block after the `CFP_WEBHOOK_SECRET` block, in the file's existing voice (a comment
explaining why, then the assignments). It must state: the widget renders only when
`PUBLIC_TURNSTILE_SITEKEY` is set, and that variable is read at **build** time, so a deploy from a
machine without it ships a form with no widget; the endpoint **refuses** every submission while
`TURNSTILE_SECRET_KEY` is unset; the secret lives as a Worker secret
(`npx wrangler secret put TURNSTILE_SECRET_KEY`); the sitekey is public by design (`PUBLIC_`
prefix, same reasoning as `PUBLIC_CF_BEACON_TOKEN`). Then document the **local** pair, taken from
Cloudflare's docs ("Test your Turnstile implementation") and clearly labelled as test-only:

```
# Local development only: Cloudflare's always-pass test pair. They work on localhost and
# any domain, and only match each other: a production secret rejects the dummy token, and
# the test secret would accept anyone, so it must never be set as the Worker secret.
#   PUBLIC_TURNSTILE_SITEKEY=1x00000000000000000000AA
#   TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
PUBLIC_TURNSTILE_SITEKEY=
TURNSTILE_SECRET_KEY=
```

The test-key lines are **comments** in the example file: the variables themselves stay empty, so
copying the file never gives a deployed build a test secret. For `npm run dev` the Worker secret
comes from the local `.dev.vars` file, not `.env`; tell the reader to put the **secret** there
(`.dev.vars` is already git-ignored, `.gitignore` line 27) and the sitekey in `.env`.

Do **not** write any real key anywhere.

**Verify**: `grep -n 'TURNSTILE' .env.example` → shows both variable names with empty values and the
commented test pair; `git check-ignore .dev.vars` → prints `.dev.vars`.

### Step 5: One README paragraph

In `README.md`, directly after the paragraph that starts "**Contact-form opt-in.**"
(around line 172-183), add a short paragraph titled `**Contact-form verification.**`
saying: the endpoint verifies a Turnstile token and **refuses every submission while the
secret is unset** (the form fails closed, answering 503 with the "write to info@" message);
local development uses Cloudflare's test-key pair documented in `.env.example`; the sitekey is
inlined at build time, so deploy with `npm run deploy` from a machine whose `.env` has it.

**Verify**: `grep -n "Contact-form verification" README.md` → one match.

### Step 6: Deploy and verify against the real worker

Only after **step 0 is confirmed**. `npm run deploy`, then:

```sh
H='-H origin:https://next.rahlwes.eu -H content-type:application/json'
# malformed bodies -> 400, not 500
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://next.rahlwes.eu/api/kontakt $H --data 'null'
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://next.rahlwes.eu/api/kontakt $H --data '{"fname":123}'
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://next.rahlwes.eu/api/newsletter/subscribe $H --data '{"email":123}'
# the widget is on the page (sitekey was inlined at build time)
curl -s https://next.rahlwes.eu/ | grep -c 'cf-turnstile'
# a complete submission WITHOUT a Turnstile token must be refused before any mail is sent
curl -s -w '\n%{http_code}\n' -X POST https://next.rahlwes.eu/api/kontakt $H \
  --data '{"fname":"A","lname":"B","email":"<a mailbox you control>","message":"x","consent":true,"locale":"de"}'
```

Expected: `400`, `400`, `400`; a count of `1` or more; then a JSON reply with `"ok":false` and
status `403` (the secret exists and the token is missing). Use a real mailbox you control for
the last request and **never** an `@example.com` address (AGENTS.md); with the fix no mail is sent.

Finally, the one check an executor cannot do: a **real** submission through the page in a browser,
with the real widget, must reach `info@rahlwes.eu` and send the confirmation mail. Report that it
is **pending the operator** if you cannot run it.

## Test plan

There is no test harness for `src/pages/api` and building one is out of scope. Verification is the
curl matrix in step 6 and `npm run check`. Do **not** write new vitest tests that mock
`cloudflare:workers`; that import only resolves inside the Workers runtime.

## Done criteria

- [ ] `npm run check` exits 0 with `0 errors`
- [ ] `npm test` reports 56 passed, 9 skipped
- [ ] `npm run build` exits 0
- [ ] Step 0 was confirmed before deploying: the secret name is listed and the sitekey is in `.env`
- [ ] On the deployed worker: `null`, `{"fname":123}` and `{"email":123}` bodies return `400`
- [ ] On the deployed worker: the home page contains `cf-turnstile`, and a submission **without** a token returns `403`, not `200`
- [ ] `grep -n TURNSTILE .env.example` shows both variables with empty values
- [ ] `git status` shows only in-scope files changed
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" does not match the excerpts.
- Step 0 is not satisfied: `TURNSTILE_SECRET_KEY` is not listed by `wrangler secret list`, or
  `.env` has no `PUBLIC_TURNSTILE_SITEKEY`. **Do not deploy**: the contact form would go offline.
- The Turnstile **test secret** (`1x0000000000000000000000000000000AA`) is, or is about to be, set
  as the Worker secret. Stop: it would accept anyone.
- A curl in step 6 returns `200` or sends a mail. **Stop immediately**, do not retry, and
  tell the operator which request produced it.
- You are asked to add Turnstile to the newsletter signup form (out of scope; a decision).
- The fix appears to require editing the consent wording or the confirmation mail body.

## Maintenance notes

- Failing closed means the form is **down** until both the widget (sitekey, at build time) and
  `TURNSTILE_SECRET_KEY` exist; step 0 exists to prevent a deploy in between. The visitor sees the
  existing "write to info@rahlwes.eu" message with HTTP 503 if the secret is ever lost.
- If a second public form is added, copy the `asStrings` guard; if there are three,
  promote it to `src/utils/` and delete the copies.
- The confirmation mail still echoes the submitter's text. That is acceptable once
  Turnstile gates the endpoint; if abuse reappears, the next step is to drop the echo or
  send the confirmation only after a human check, not to loosen anything here.
- Deferred: a Turnstile widget on the newsletter signup (`wrangler.jsonc:29-31` records the
  current "per-IP limit plus one-hour per-address cooldown" tradeoff).
