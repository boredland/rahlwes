# Plan 005: Stop upstream error messages from carrying the request URL's query string

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 14c7500..HEAD -- src/ankai/lib/http.ts src/ankai/lib/fetch-proxy.ts src/ankai/lib/gateway.ts src/ankai/adapters/ddb.ts test/ankai`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (001 recommended)
- **Category**: security
- **Planned at**: commit `14c7500`, 2026-11-17

## Why this matters

The archive search (`/admin/search/`, behind the Keystatic login) sends the Deutsche Digitale
Bibliothek API key to DDB **as a query parameter** (`oauth_consumer_key`). When DDB answers with
a non-200 (throttling, an outage, a wrong key), `fetchJson` throws an error whose message
contains the **full request URL, key included**. The gateway copies that message into the
JSON response and the search page shows it as a tooltip. So any DDB hiccup would print the
Worker secret into the browser, its network tab and any screenshot. **Today this is latent:**
`DDB_API_KEY` is not set as a Worker secret on `next.rahlwes.eu` (checked with
`npx wrangler secret list`), and the adapter returns early without a key. It becomes live
the day someone adds the key to enable the adapter, which `README.md` and `.env.example`
tell them to do. This plan removes the leak before that day.

## Current state

- `src/ankai/adapters/ddb.ts` lines 34-49 — the adapter puts the key into the URL:
  ```ts
  async search(q: PersonQuery, ctx: Ctx): Promise<AdapterResult> {
    const key = ctx.env.DDB_API_KEY;
    if (!key) return { records: [], degraded: true };
    …
    const url = new URL(`${BASE}/search`);
    url.searchParams.set("query", terms);
    url.searchParams.set("sector_fct", "sec_02");
    url.searchParams.set("rows", String(q.limit));
    url.searchParams.set("cursorMark", q.cursor ?? "*");
    url.searchParams.set("sort", "id asc"); // cursorMark requires a deterministic sort
    url.searchParams.set("oauth_consumer_key", key);

    const body = await fetchJson<DdbSearchResponse>(url.toString(), {}, ctx.signal, UPSTREAM_CACHE_TTL);
  ```
  This is the **only** place in `src/ankai` where a credential is placed in a URL
  (`grep -rn "oauth_consumer_key\|api_key\|access_token\|token=" src/ankai` → one match).
- `src/ankai/lib/http.ts` lines 17-46 — both helpers embed the **whole URL** in the thrown error:
  ```ts
  export async function fetchJson<T>(url: string, init: RequestInit, signal: AbortSignal, cacheTtl?: number): Promise<T> {
    const res = await fetch(url, { …init, …cacheInit(cacheTtl), signal, headers: { … } });
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);   // line 29
    return (await res.json()) as T;
  }

  export async function fetchText(url: string, signal: AbortSignal, headers?: HeadersInit, cacheTtl?: number): Promise<string> {
    const res = await fetch(url, { … });
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);   // line 44
    return res.text();
  }
  ```
  Callers: `ddb.ts:49`, `ehri.ts:52,61`, `kalliope.ts:30`, `lib/gnd.ts:21`.
- `src/ankai/lib/gateway.ts` lines 84-88 copies the message to the client:
  ```ts
  const reason = outcome.reason;
  perSource[adapter.id] = {
    ok: false,
    error: reason instanceof Error ? reason.message : String(reason),
  };
  ```
- `src/pages/api/admin/ankai/search.ts` line 32 returns that object as JSON;
  `src/components/ArchiveSearch.tsx` line 143 shows it as `title={s.error ?? ''}`.
- `src/ankai/lib/fetch-proxy.ts` lines 48 and 88 put `targetUrl` / `labelUrl` into errors too
  (`fetch-proxy ${targetUrl} -> HTTP …`). Those are **target** URLs (the archive being
  scraped), not the proxy URL; the proxy token travels in an `Authorization` header and is
  **not** in any message. Leave them alone unless a target URL carries a secret (it does not
  today: `grep` finds no credential in a `targetUrl`).
- Other thrown messages (`arolsen.ts:148,167`, `jmf-collection.ts:30`, `shoah-frankfurt.ts:41`)
  already print only a label and the status, never a URL.
- **Tests:** `test/ankai/adapters.test.ts` is the exemplar. The DDB block is lines 89-122; it
  uses `installMockFetch` from `test/ankai/helpers/mock-fetch.ts` (routes by URL substring,
  records calls, throws on unmatched URLs) and restores it in `afterEach`. Existing assertions
  check the **request** URL contains `oauth_consumer_key=k`
  (`adapters.test.ts:111`); that assertion must keep passing, because the key must still
  be **sent**. Only the **error text** changes. No existing test asserts on an error message
  containing a URL (`grep -n "HTTP\|toThrow\|rejects" test/ankai` → only a `new URL(...)`
  check in `providers.test.ts:44`).
- Test style (note the repo's tests use **double quotes and semicolons**, unlike `src/pages`):
  `import { afterEach, describe, expect, it } from "vitest";`, `let mock: MockFetch | undefined;`,
  `afterEach(() => mock?.restore());`, `const ctx = (env: Partial<AnkaiEnv> = {}): Ctx => ({ env: env as AnkaiEnv, signal: noSignal });`.
- Conventions: comments explain **why**, never what. **Never write a real key into any file.**
  Use an obviously fake value such as `"test-key-123"` in tests.

## Commands you will need

| Purpose   | Command                                                    | Expected on success                    |
|-----------|------------------------------------------------------------|----------------------------------------|
| Tests     | `npm test`                                                 | 56 passed, 9 skipped before; 58+ after |
| One file  | `npx vitest run test/ankai/adapters.test.ts`               | all pass                               |
| Typecheck | `npm run check`                                            | `0 errors` (plan 001 adds it; before it lands, `npx astro check`) |
| Build     | `npm run build`                                            | exit 0                                 |

## Scope

**In scope** (the only files you should modify):
- `src/ankai/lib/http.ts`
- `test/ankai/adapters.test.ts` (add tests inside the existing DDB `describe`)

**Out of scope** (do NOT touch):
- `src/ankai/adapters/ddb.ts`: the key must keep being **sent** in the query string. DDB's
  API may not accept it in a header; changing the transport is a different, riskier plan.
  Do not move the key to a header.
- `src/ankai/lib/gateway.ts` (the copy of `reason.message` is fine once the message is clean)
- `src/ankai/lib/fetch-proxy.ts`, other adapters
- `.env.example`, `README.md`

## Git workflow

- Branch: `advisor/005-redact-error-urls`
- One commit; style: short, imperative, no prefix, no attribution lines
  (example from `git log`: `User-Agent auf next.rahlwes.eu umstellen`).
- Do NOT push unless the operator instructed it.

## Steps

### Step 1: Write the failing tests first

In `test/ankai/adapters.test.ts`, inside `describe("DDB adapter", …)` (lines 89-122), add:

```ts
  it("never puts the API key into an error when DDB answers with an error status", async () => {
    mock = installMockFetch([{ match: "/search", status: 429, body: { error: "slow down" } }]);
    const attempt = ddbAdapter.search({ name: "Frankfurt", limit: 5 }, ctx({ DDB_API_KEY: "test-key-123" }));
    await expect(attempt).rejects.toThrow(/HTTP 429/);
    await expect(attempt).rejects.not.toThrow(/test-key-123/);
  });

  it("still sends the key to DDB", async () => {
    mock = installMockFetch([{ match: "/search", body: { numberOfResults: 0, results: [] } }]);
    await ddbAdapter.search({ name: "Frankfurt", limit: 5 }, ctx({ DDB_API_KEY: "test-key-123" }));
    expect(mock.calls[0]!.url).toContain("oauth_consumer_key=test-key-123");
  });
```

Also add one test that the **origin and path** survive, since other callers rely on them
to diagnose which upstream failed. Put it in the same describe:

```ts
  it("keeps the host and path in the error so a failing source can still be diagnosed", async () => {
    mock = installMockFetch([{ match: "/search", status: 500, body: "boom" }]);
    await expect(
      ddbAdapter.search({ name: "Frankfurt", limit: 5 }, ctx({ DDB_API_KEY: "test-key-123" })),
    ).rejects.toThrow(/api\.deutsche-digitale-bibliothek\.de\/search/);
  });
```

If `BASE` in `ddb.ts` is not `https://api.deutsche-digitale-bibliothek.de` (read line ~10 of
`ddb.ts`), change the regex in the third test to match the real host.

A promise that is awaited twice (`attempt` above) rejects both times with the same error;
that is intended. If your assertion style complains, create the promise once and store the
caught error instead: `const error = await attempt.catch((e) => e)`, then assert on
`(error as Error).message`.

**Verify**: `npx vitest run test/ankai/adapters.test.ts` → the first new test **fails**
(it finds the key in the message), the other two pass. If the first does not fail, STOP
(see STOP conditions).

### Step 2: Redact the query string in `http.ts`

Add one small helper and use it at both throw sites (lines 29 and 44):

```ts
/**
 * The query string is where credentials travel for upstreams that take their key as a
 * parameter, and these messages reach the browser through the gateway's per-source
 * status. The host and path are enough to tell which source failed.
 */
function withoutQuery(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.split("?")[0]!;
  }
}
```

Then: `throw new Error(`${withoutQuery(url)} -> HTTP ${res.status}`);` at both sites. Do not
change any other behaviour in the file.

**Verify**: `npx vitest run test/ankai/adapters.test.ts` → all pass, including the three new tests.

### Step 3: Run the full suite, typecheck and build

**Verify**:
- `npm test` → exit 0, `59 passed` (56 + 3) and 9 skipped.
- `npm run check` → `0 errors`.
- `npm run build` → exit 0.
- `grep -rn 'oauth_consumer_key' src/ankai` → still exactly one match, in `ddb.ts` (the key is still sent).

## Test plan

- Three tests in `test/ankai/adapters.test.ts`, inside `describe("DDB adapter")`, modelled on
  the existing "restricts to the archive sector…" test (`adapters.test.ts:96-115`):
  1. the error text does not contain the key (the regression),
  2. the key is still sent (guards against "fixing" it by deleting the parameter),
  3. host and path remain in the message (guards against redacting too much).
- Each is deterministic: `installMockFetch` is offline and throws on unmatched URLs.
- Verification: `npm test` → 59 passed, 9 skipped.

## Done criteria

- [ ] `npm test` exits 0 with the three new tests passing (59 passed, 9 skipped)
- [ ] The "never puts the API key into an error" test failed before step 2 and passes after
- [ ] `npm run check` shows `0 errors`; `npm run build` exits 0
- [ ] `grep -rn 'oauth_consumer_key' src/ankai` returns exactly one match (`ddb.ts`)
- [ ] `git status` shows only `src/ankai/lib/http.ts` and `test/ankai/adapters.test.ts` modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" does not match the excerpts.
- In step 1 the key-leak test **passes** before your change: the leak is not where this plan
  says it is; report what the message actually contains.
- Any pre-existing test fails after step 2.
- You are tempted to move the key into a request header, remove the parameter, or log it.
- You find a second place where a credential enters a URL or an error message.

## Maintenance notes

- If the DDB API is later found to accept the key in a header (its OpenAPI docs are linked in
  `.env.example`), moving it there removes the exposure at the source; this plan then becomes
  defence in depth, which is still worth keeping.
- A new adapter that puts a credential in a URL is covered automatically if it uses
  `fetchJson` / `fetchText`; one that throws its own `Error` with the URL is not.
- **Operator action, not part of this plan:** if `DDB_API_KEY` was ever set and a DDB error was
  ever displayed, rotate the key. Today it is unset, so there is nothing to rotate.
