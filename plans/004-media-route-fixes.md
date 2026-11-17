# Plan 004: Make the `/media/*` route answer malformed and conditional requests correctly

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 14c7500..HEAD -- src/worker.ts wrangler.jsonc`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (001 recommended)
- **Category**: bug
- **Planned at**: commit `14c7500`, 2026-11-17

## Why this matters

`serveMedia()` in `src/worker.ts` serves the Nachgefragt trailer from an R2 bucket with
HTTP range support, so video can seek and play in Safari. Four request shapes were probed
against `next.rahlwes.eu` and answered wrongly: a malformed `%` escape and an
unsatisfiable range both return `500`, a failed `If-Match` / `If-Unmodified-Since` returns
`304` instead of `412`, and an invalid range (`bytes=5-2`) returns `206` with the whole
file. None is exploitable and real browsers rarely send these, but they are bugs in code
that was written for the trailer, they generate Worker error noise, and they are cheap to
fix while the code is fresh. Range support itself (`206` with a correct `Content-Range`,
suffix ranges, plain `200`, `HEAD`, `If-None-Match` → `304`) is **correct today** and must
not regress.

## Current state

- `src/worker.ts` lines 154-187 — the route (inside the Worker's `fetch`, called from
  line 191). Current code:
  ```ts
  async function serveMedia(request: Request, env: Env): Promise<Response | null> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/media/')) return null
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 })

    const key = decodeURIComponent(url.pathname.slice('/media/'.length))
    const object = await env.MEDIA.get(key, { range: request.headers, onlyIf: request.headers })
    if (!object) return new Response('Not found', { status: 404 })

    const headers = new Headers()
    object.writeHttpMetadata(headers)
    headers.set('etag', object.httpEtag)
    headers.set('accept-ranges', 'bytes')
    headers.set('cache-control', 'public, max-age=31536000, immutable')

    if (!('body' in object)) return new Response(null, { status: 304, headers })

    const range = object.range
    if (request.headers.has('range') && range && 'offset' in range) {
      const offset = range.offset ?? 0
      const length = range.length ?? object.size - offset
      headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${object.size}`)
      headers.set('content-length', String(length))
      return new Response(request.method === 'HEAD' ? null : object.body, { status: 206, headers })
    }

    headers.set('content-length', String(object.size))
    return new Response(request.method === 'HEAD' ? null : object.body, { status: 200, headers })
  }
  ```
- Binding: `wrangler.jsonc` has `"r2_buckets": [{ "binding": "MEDIA", "bucket_name": "rahlwes-media" }]`.
  The bucket contains one object: `nachgefragt-trailer.mp4` (17,673,797 bytes, `video/mp4`).
  Generated type: `MEDIA: R2Bucket` in `worker-configuration.d.ts`.
- `R2Bucket.get(key, { range, onlyIf })` accepts a `Headers` object for both options. When a
  precondition **fails**, R2 returns an `R2Object` **without** a `body` (that is the
  `!('body' in object)` branch). R2 does not say which precondition failed, so the handler
  must decide from the **request headers**. When a range cannot be satisfied R2 **throws**
  (that is the 500 for `bytes=99999999-`). Verify the thrown error's `message` before
  relying on its text (see Step 2).
- **Probe results on `next.rahlwes.eu` (the acceptance table):**

  | Request | Today | Correct |
  |---|---|---|
  | `GET /media/%E0%A4%A` (malformed escape) | `500` | `400` |
  | `GET` with `If-Match: "nope"` | `304` | `412` |
  | `GET` with `If-Unmodified-Since: Mon, 01 Jan 2001 00:00:00 GMT` | `304` | `412` |
  | `GET` with `Range: bytes=99999999-` | `500` | `416` + `Content-Range: bytes */17673797` |
  | `GET` with `Range: bytes=5-2` | `206`, full body | `200`, full body (an invalid range is ignored, per RFC 9110) |
  | `GET` with `If-None-Match: <current etag>` | `304` | `304` (already correct) |
  | `GET` with `Range: bytes=0-99` | `206`, 100 bytes | unchanged |
  | `GET` with `Range: bytes=-100` | `206`, 100 bytes, `Content-Range: bytes 17673697-17673796/17673797` | unchanged |
  | plain `GET` / `HEAD` | `200`, 17673797 bytes | unchanged |
  | `GET /media/nope.mp4` | `404` | unchanged |

- The static asset layer answers before the Worker for any path that exists in `dist/`.
  `/media/nachgefragt-trailer-poster.jpg` is a static asset (`public/media/`), so it never
  reaches `serveMedia`; only keys that are **not** files in `public/media/` do.
- Conventions: comments explain **why**, never what (AGENTS.md). Match the existing
  comment voice above `serveMedia`. There are **no worker tests** and `vitest.config.ts`
  uses a plain Node pool; do not add mocked tests for this function.

## Commands you will need

| Purpose   | Command                  | Expected on success                          |
|-----------|--------------------------|----------------------------------------------|
| Typecheck | `npm run check` | `0 errors` (plan 001 adds it; before it lands, `npx astro check`, which needs `@astrojs/check` and `typescript`) |
| Tests     | `npm test`               | 56 passed, 9 skipped                         |
| Deploy    | `npm run deploy`         | prints `Current Version ID:`                 |
| ETag      | `curl -sI https://next.rahlwes.eu/media/nachgefragt-trailer.mp4 \| grep -i '^etag'` | a quoted hex ETag |

## Scope

**In scope** (the only files you should modify):
- `src/worker.ts` — `serveMedia` only

**Out of scope** (do NOT touch):
- `handleOneClickUnsubscribe`, `deliver`, `queue`, `scheduled` in the same file
- `wrangler.jsonc`, `worker-configuration.d.ts`
- The cache header (`public, max-age=31536000, immutable`): keys are manually versioned
  by the operator. Do not change it.
- Adding `x-content-type-options: nosniff`: a reasonable hardening, but a separate
  decision (it belongs with the security-header work, not this plan)

## Git workflow

- Branch: `advisor/004-media-route`
- One commit; message style: short, imperative, no prefix, no attribution lines
  (example from `git log`: `Serve the Nachgefragt trailer from R2 with range support`).
- Do NOT push unless the operator instructed it.

## Steps

### Step 1: Reject a malformed escape with 400

Replace the `decodeURIComponent` line with a guarded decode:

```ts
let key: string
try {
  key = decodeURIComponent(url.pathname.slice('/media/'.length))
} catch {
  return new Response('Bad request', { status: 400 })
}
```

**Verify**: `npm run check` → `0 errors`.

### Step 2: Find out what R2 throws for an unsatisfiable range (do this before coding the 416)

R2 reports an unsatisfiable range by **throwing** from `get`. Do not guess its message.
Add a temporary `console.error('r2 get failed', error)` in a `catch` around the `get`,
deploy, request `Range: bytes=99999999-` once, and read the logged text with
`npx wrangler tail rahlwes --format pretty` (the Worker is named `rahlwes`). Record the
exact error `message`. Then **remove the temporary log**.

If the message clearly identifies an invalid range (for example contains the words
`range` and `satisf` or an `R2` error code naming it), match on that. If it does not,
use the fallback below, which needs no message matching.

### Step 3: Handle an unsatisfiable range with 416 (size-aware, no message matching)

Wrap the ranged `get` so that **any** throw on a request carrying `Range` is answered by
learning the object size with `head()` and returning 416 when the object exists:

```ts
let object: R2Object | R2ObjectBody | null
try {
  object = await env.MEDIA.get(key, { range: request.headers, onlyIf: request.headers })
} catch (error) {
  if (!request.headers.has('range')) throw error
  // R2 throws when the range starts past the end of the object. The size is needed for
  // the Content-Range a 416 must carry, and a throw for any other reason has no object.
  const meta = await env.MEDIA.head(key)
  if (!meta) throw error
  return new Response(null, { status: 416, headers: { 'content-range': `bytes */${meta.size}` } })
}
if (!object) return new Response('Not found', { status: 404 })
```

Rationale to keep as a comment: a thrown range error needs the object size to build the
`Content-Range` header, which only `head()` can supply.

**Verify**: `npm run check` → `0 errors`.

### Step 4: Answer a failed precondition with 412 unless the client asked for a 304

A body-less `R2Object` means "a precondition did not hold". Decide the status from the
request headers: `304` only when the request carried a validator that makes 304 the right
answer (`If-None-Match` or `If-Modified-Since`), otherwise `412`:

```ts
if (!('body' in object)) {
  const conditionalGet = request.headers.has('if-none-match') || request.headers.has('if-modified-since')
  return new Response(null, { status: conditionalGet ? 304 : 412, headers })
}
```

Keep the `headers` (etag, cache-control) on both. A request with **both** `If-Match` and
`If-None-Match` is not worth special handling; leave it as written and note it in your report.

**Verify**: `npm run check` → `0 errors`.

### Step 5: Ignore a syntactically invalid range instead of serving a partial answer

`bytes=5-2` currently returns `206` with the whole file (`Content-Range: bytes 0-N/N+1`).
The 206 path trusts `object.range`. Guard it by checking that the range actually
narrowed the response, otherwise fall through to the `200` branch:

```ts
const range = object.range
if (request.headers.has('range') && range && 'offset' in range) {
  const offset = range.offset ?? 0
  const length = range.length ?? object.size - offset
  if (length < object.size) {
    // …existing 206 response…
  }
}
```

A valid request for the **whole** file as a range (`bytes=0-`) then returns `200` with the
full body instead of `206`. That is valid HTTP, but **verify it does not break seeking**
in Step 7 before keeping it. If a player requests `bytes=0-` first and then stalls, revert
this step and report; do not paper over it.

**Verify**: `npm run check` → `0 errors`.

### Step 6: Deploy

`npm run deploy`. Note the printed `Current Version ID:` in your report.

### Step 7: Run the acceptance matrix against the deployed worker

```sh
U=https://next.rahlwes.eu/media/nachgefragt-trailer.mp4
E=$(curl -sI $U | grep -i '^etag' | cut -d' ' -f2 | tr -d '\r')

curl -s -o /dev/null -w '%{http_code}\n' --path-as-is "https://next.rahlwes.eu/media/%E0%A4%A"        # 400
curl -s -o /dev/null -w '%{http_code}\n' -H 'If-Match: "nope"' $U                                       # 412
curl -s -o /dev/null -w '%{http_code}\n' -H 'If-Unmodified-Since: Mon, 01 Jan 2001 00:00:00 GMT' $U     # 412
curl -s -D - -o /dev/null -H 'Range: bytes=99999999-' $U | grep -iE '^HTTP|content-range'               # 416, bytes */17673797
curl -s -D - -o /dev/null -H 'Range: bytes=5-2' $U | grep -iE '^HTTP|content-range|content-length'      # 200, 17673797
curl -s -o /dev/null -w '%{http_code}\n' -H "If-None-Match: $E" $U                                       # 304

# must NOT regress
curl -s -D /tmp/r1 -o /tmp/r1.bin -H 'Range: bytes=0-99' $U;   grep -iE '^HTTP|content-range|content-length' /tmp/r1; wc -c < /tmp/r1.bin   # 206, bytes 0-99/17673797, 100
curl -s -D /tmp/r2 -o /tmp/r2.bin -H 'Range: bytes=-100' $U;   grep -iE '^HTTP|content-range|content-length' /tmp/r2; wc -c < /tmp/r2.bin   # 206, bytes 17673697-17673796/17673797, 100
curl -s -D - -o /dev/null -H 'Range: bytes=5000000-' $U | grep -iE '^HTTP|content-range'                # 206, bytes 5000000-17673796/17673797
curl -sI $U | grep -iE '^HTTP|content-length|accept-ranges'                                              # 200, 17673797, bytes
curl -s -o /dev/null -w '%{http_code}\n' https://next.rahlwes.eu/media/nope.mp4                          # 404
curl -s $U | sha256sum | cut -c1-16                                                                      # 32b137215ffc1da0
```

The full-body hash `32b137215ffc1da0` is the SHA-256 prefix of the file as uploaded
(`trailer-h264.mp4`); a different hash means the object changed, which is a STOP.

Finally ask the operator (or check yourself in a real browser) that
`https://next.rahlwes.eu/projekte/nachgefragt/` still plays and seeks. If you cannot open
a browser, report that this last check is pending.

**Verify**: every line above matches its comment. Paste the actual outputs in your report.

## Test plan

No worker test harness exists and `cloudflare:workers` bindings cannot run under the plain
Node pool. The acceptance matrix in Step 7 **is** the test plan: it is the ten probes from
the audit plus the regression checks, each with an exact expected result. Do not add mocked
unit tests that assert on a fake `R2Bucket`; they would pin your implementation and prove
nothing about R2's real behaviour.

## Done criteria

- [ ] `npm run check` shows `0 errors`; `npm test` still 56 passed, 9 skipped
- [ ] Deployed: malformed escape → `400`; `If-Match` mismatch → `412`; `If-Unmodified-Since` in the past → `412`
- [ ] Deployed: `Range: bytes=99999999-` → `416` with `Content-Range: bytes */17673797`
- [ ] Deployed: `Range: bytes=5-2` → `200`, 17673797 bytes
- [ ] Deployed: `bytes=0-99`, `bytes=-100`, `bytes=5000000-`, `HEAD`, plain `GET`, `If-None-Match`, missing key all behave as before
- [ ] Full-body hash prefix is `32b137215ffc1da0`
- [ ] `git status` shows only `src/worker.ts` modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" does not match the excerpts.
- Step 2 shows R2 does **not** throw for `bytes=99999999-` (the 500 has another cause);
  report the real error.
- Step 5 makes the trailer stall or fail to seek in a browser: revert Step 5 only.
- Any regression row in Step 7 changes.
- You find the object in the bucket has changed (hash mismatch): do **not** re-upload;
  report it.
- A fix seems to need a change to `wrangler.jsonc` or the bucket.

## Maintenance notes

- If a second media file is added, upload it to the `rahlwes-media` bucket under a
  versioned key (the route caches for a year with `immutable`); never overwrite a key.
- `public/media/` static files shadow this route for the same path (Workers Assets answers
  first). The trailer's `.mp4` was removed from `public/media/` for that reason; do not
  copy it back.
- Plan 006 adds a caption file under `/media/`; it will be served by this route once it is
  uploaded to R2, so these fixes apply to it too.
- A reviewer should scrutinise Step 5 (the only change that alters a currently-correct
  status code for valid input) and the `head()` fallback in Step 3.
