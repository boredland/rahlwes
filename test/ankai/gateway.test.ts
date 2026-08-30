import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, fanOut, type FanOutDeps } from "../../src/ankai/lib/gateway";
import type { AdapterResult, ArchiveAdapter, ArchiveRecord, Ctx, AnkaiEnv, PersonQuery } from "../../src/ankai/types";

const env = {} as AnkaiEnv;
const baseQuery: PersonQuery = { limit: 20, name: "Test" };

function record(source: string, id: string): ArchiveRecord {
  return { source, sourceId: id, landingUrl: `https://example.org/${source}/${id}`, title: `${source}-${id}` };
}

function stubAdapter(id: string, result: AdapterResult): ArchiveAdapter {
  return { id, label: id, role: "records", search: async () => result };
}

function failingAdapter(id: string, message: string): ArchiveAdapter {
  return {
    id,
    label: id,
    role: "records",
    search: async () => {
      throw new Error(message);
    },
  };
}

/** Never resolves until aborted — proves per-source timeout doesn't sink the request. */
function hangingAdapter(id: string): ArchiveAdapter {
  return {
    id,
    label: id,
    role: "records",
    search: (_q: PersonQuery, ctx: Ctx) => {
      const { promise, reject } = Promise.withResolvers<AdapterResult>();
      ctx.signal.addEventListener("abort", () => reject(new Error("aborted")));
      return promise;
    },
  };
}

const deps = (adapters: ArchiveAdapter[], timeoutMs = 50): FanOutDeps => ({ adapters, linkOutBuilders: [], timeoutMs });

describe("fanOut", () => {
  it("tiebreaks equal-relevance results round-robin across sources (rank order)", async () => {
    // No record matches the query, so all score 0 and fall back to within-source rank:
    // a#0, b#0, a#1 — i.e. round-robin, so no single source dominates a relevance band.
    const a = stubAdapter("a", { records: [record("a", "1"), record("a", "2")] });
    const b = stubAdapter("b", { records: [record("b", "1")] });
    const res = await fanOut(baseQuery, env, deps([a, b]));
    expect(res.results.map((r) => r.sourceId + r.source)).toEqual(["1a", "1b", "2a"]);
    expect(res.perSource.a!.ok).toBe(true);
    expect(res.perSource.a!.returned).toBe(2);
  });

  it("ranks a strong match above weaker ones regardless of source order", async () => {
    // Source "a" returns two weak (place-only) hits first; source "b" returns an exact
    // person-name match. The name match must rank first even though its source is second.
    const weak1 = { source: "a", sourceId: "1", landingUrl: "https://example.org/a/1", title: "Berlin street directory" };
    const weak2 = { source: "a", sourceId: "2", landingUrl: "https://example.org/a/2", title: "Berlin misc" };
    const strong = { source: "b", sourceId: "9", landingUrl: "https://example.org/b/9", personName: "Rene Weiss" };
    const a = stubAdapter("a", { records: [weak1, weak2] });
    const b = stubAdapter("b", { records: [strong] });
    const res = await fanOut({ limit: 20, name: "Rene Weiss", keywords: "Berlin" }, env, deps([a, b]));
    expect(res.results[0]!.sourceId).toBe("9"); // exact name match wins cross-source
    expect(res.results[0]!.source).toBe("b");
  });

  it("returns partial results when one source fails (no throw)", async () => {
    const ok = stubAdapter("ok", { records: [record("ok", "1")], total: 1 });
    const bad = failingAdapter("bad", "boom");
    const res = await fanOut(baseQuery, env, deps([ok, bad]));
    expect(res.results).toHaveLength(1);
    expect(res.perSource.ok!.ok).toBe(true);
    expect(res.perSource.bad!.ok).toBe(false);
    expect(res.perSource.bad!.error).toBe("boom");
  });

  it("times out a hanging source but still returns others", async () => {
    const ok = stubAdapter("ok", { records: [record("ok", "1")] });
    const res = await fanOut(baseQuery, env, deps([ok, hangingAdapter("slow")], 30));
    expect(res.perSource.ok!.ok).toBe(true);
    expect(res.perSource.slow!.ok).toBe(false);
  });

  it("packs and unpacks per-source cursors, scoping each adapter to its own", async () => {
    let seenCursor: string | undefined;
    const a: ArchiveAdapter = {
      id: "a",
      label: "a",
      role: "records",
      search: async (q: PersonQuery) => {
        seenCursor = q.cursor;
        return { records: [record("a", "1")], cursor: "a-next" };
      },
    };
    const gatewayCursor = encodeCursor({ a: "a-prev" });
    const res = await fanOut({ ...baseQuery, cursor: gatewayCursor }, env, deps([a]));
    expect(seenCursor).toBe("a-prev");
    expect(decodeCursor(res.query.cursor)).toEqual({ a: "a-next" });
  });

  it("drops the gateway cursor when no source has more pages", async () => {
    const a = stubAdapter("a", { records: [record("a", "1")] });
    const res = await fanOut(baseQuery, env, deps([a]));
    expect(res.query.cursor).toBeUndefined();
  });

  it("ignores linkout-role adapters in the search fan-out", async () => {
    const linkonly: ArchiveAdapter = { id: "lo", label: "lo", role: "linkout", search: async () => ({ records: [record("lo", "x")] }) };
    const res = await fanOut(baseQuery, env, deps([linkonly]));
    expect(res.results).toHaveLength(0);
    expect(res.perSource.lo).toBeUndefined();
  });
});

describe("cursor codec", () => {
  it("round-trips and tolerates garbage", () => {
    expect(decodeCursor(encodeCursor({ x: "1", y: "2" }))).toEqual({ x: "1", y: "2" });
    expect(decodeCursor(undefined)).toEqual({});
    expect(decodeCursor("!!!not-base64!!!")).toEqual({});
  });
});
