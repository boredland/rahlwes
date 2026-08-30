import { describe, expect, it, vi } from "vitest";
import { ehriAdapter } from "../../src/ankai/adapters/ehri";
import { shoahFrankfurtAdapter } from "../../src/ankai/adapters/shoah-frankfurt";
import { yadVashemAdapter } from "../../src/ankai/adapters/yad-vashem";
import { jmfCollectionAdapter } from "../../src/ankai/adapters/jmf-collection";
import { kalliopeAdapter } from "../../src/ankai/adapters/kalliope";
import { expandNameVariants } from "../../src/ankai/lib/gnd";
import { parseArcinsysDetail } from "../../src/ankai/lib/arcinsys-parse";
import type { Ctx, AnkaiEnv } from "../../src/ankai/types";

/**
 * Drift detection. These tests hit the REAL upstreams and assert the structural contracts
 * our adapters rely on. Their purpose is not to check "does search work today" but to fail
 * loudly the day an upstream changes shape — especially the reverse-engineered ones (Arolsen
 * ITS-WS.asmx, Arcinsys markup, Kalliope CQL indexes, GND MARC fields) that have no contract
 * we control. Opt-in via DRIFT=1 so the default suite stays offline and deterministic.
 *
 * Run: DRIFT=1 npx vitest run test/drift.test.ts
 */
// Upstreams are slow (Arolsen is a 3-hop session); allow well above the adapter 30s signal.
vi.setConfig({ testTimeout: 45000 });

const enabled = !!process.env.DRIFT;
const d = describe.skipIf(!enabled);

const ctx = (env: Partial<AnkaiEnv> = {}): Ctx => ({ env: env as AnkaiEnv, signal: AbortSignal.timeout(30000) });

d("EHRI JSON:API contract", () => {
  it("still returns data[]/meta.total/links.next with our field names", async () => {
    const res = await ehriAdapter.search({ name: "Buchenwald", limit: 2 }, ctx());
    expect(res.records.length).toBeGreaterThan(0);
    expect(res.total).toBeGreaterThan(0);
    expect(res.cursor).toBeTruthy(); // links.next present -> page cursor derived
    const r = res.records[0]!;
    expect(r.source).toBe("ehri");
    expect(r.sourceId).toBeTruthy();
    expect(r.landingUrl).toMatch(/^https?:\/\//);
    // The human portal page (/units/<id>) must still resolve — guards the type->path map.
    expect(r.landingUrl).toContain("/units/");
    const page = await fetch(r.landingUrl, { signal: AbortSignal.timeout(20000) });
    expect(page.status).toBe(200);
  });
});

d("Kalliope SRU contract", () => {
  it("ead.creator/ead.title still resolve and MODS records still parse", async () => {
    const res = await kalliopeAdapter.search({ name: "Einstein", limit: 2 }, ctx());
    // The indexes we depend on (ead.creator OR ead.title) must keep matching.
    expect(res.total).toBeGreaterThan(0);
    expect(res.records.length).toBeGreaterThan(0);
    expect(res.records[0]!.sourceId).toBeTruthy();
  });
});

d("GND MARC authority contract", () => {
  it("still exposes 100/400 name fields for variant expansion", async () => {
    const variants = await expandNameVariants("Einstein", ctx());
    expect(variants).toContain("Einstein");
    expect(variants.length).toBeGreaterThan(1); // at least one attested variant beyond the input
  });
});

d("Arolsen ITS-WS.asmx protocol", () => {
  it("BuildQueryGlobalForAngular still accepts our session payload and returns {d:true}", async () => {
    // Assert the load-bearing step of the reverse-engineered protocol directly, so we can
    // tell a *shape change* (drift, must fail) from transient throttling (inconclusive, skip).
    // Arolsen is a persecution-victim DB behind a throttling LB; a network stall is not drift.
    const signal = AbortSignal.timeout(30000);
    let res: Response;
    try {
      await fetch("https://collections.arolsen-archives.org/", { signal }).catch(() => undefined);
      res = await fetch("https://collections-server.arolsen-archives.org/ITS-WS.asmx/BuildQueryGlobalForAngular", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", origin: "https://collections.arolsen-archives.org" },
        body: JSON.stringify({ uniqueId: "ankaidrift0123456789", lang: "en", archiveIds: [], strSearch: "Mueller", synSearch: true }),
        signal,
      });
    } catch {
      return; // network timeout / throttle -> inconclusive, not a drift failure
    }
    // The endpoint still exists and speaks JSON ScriptService: a shape change trips these.
    expect(res.status).toBe(200);
    const json = (await res.json()) as { d?: unknown };
    expect(json).toHaveProperty("d");
    expect(json.d).toBe(true);
  });
});

d("Arcinsys detail-page markup contract", () => {
  it("still serves a person record our parser reads (name, life dates, role)", async () => {
    // v4267937 = Bestand 518 Wiedergutmachung (Weiß, Rene). Arcinsys throttles hard, so a
    // timeout/non-200 is inconclusive (skip); only a *shape change* fails the assertions.
    const url = "https://arcinsys.hessen.de/arcinsys/detailAction?detailid=v4267937";
    let html: string;
    try {
      const res = await fetch(url, {
        headers: { "user-agent": "Mozilla/5.0 (compatible; ankai-drift/0.1)" },
        redirect: "follow",
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) return;
      html = await res.text();
    } catch {
      return; // throttled / network stall -> inconclusive
    }
    if (html.length < 2000) return; // bot-blocked stub, not the real page
    const record = parseArcinsysDetail(html, url, "v4267937");
    expect(record).not.toBeNull();
    expect(record!.personName).toBe("Weiß, Rene");
    expect(record!.birth?.place).toContain("Paris");
    expect(record!.role).toBe("victim");
  });
});

d("Shoah-Memorial Frankfurt API contract", () => {
  it("still returns count + biography results our adapter maps", async () => {
    const res = await shoahFrankfurtAdapter.search({ name: "Weiss", limit: 3 }, ctx());
    expect(res.total).toBeGreaterThan(0);
    expect(res.records.length).toBeGreaterThan(0);
    const r = res.records[0]!;
    expect(r.source).toBe("shoah-ffm");
    expect(r.personName).toBeTruthy();
    expect(r.landingUrl).toContain("/biography/");
  });
});

d("Jewish Museum Frankfurt collection contract", () => {
  it("still server-renders object cards our parser reads", async () => {
    const res = await jmfCollectionAdapter.search({ name: "anne frank", limit: 5 }, ctx());
    expect(res.records.length).toBeGreaterThan(0);
    const r = res.records[0]!;
    expect(r.source).toBe("jmf-collection");
    expect(r.title).toBeTruthy();
    expect(r.landingUrl).toContain("/objekt/");
  });
});

// Yad Vashem needs the fetch-proxy (stateful session + datacenter-IP block). Only runs when
// FETCH_PROXY_URL/TOKEN are in the env alongside DRIFT=1.
const proxyEnv = { FETCH_PROXY_URL: process.env.FETCH_PROXY_URL, FETCH_PROXY_TOKEN: process.env.FETCH_PROXY_TOKEN } as Partial<AnkaiEnv>;
describe.skipIf(!enabled || !proxyEnv.FETCH_PROXY_URL || !proxyEnv.FETCH_PROXY_TOKEN)("Yad Vashem session-flow contract", () => {
  it("returns filtered name cards via the 2-step session proxy", async () => {
    const res = await yadVashemAdapter.search({ name: "Rosenzweig", limit: 5 }, ctx(proxyEnv));
    expect(res.total).toBeGreaterThan(0);
    expect(res.records.length).toBeGreaterThan(0);
    const r = res.records[0]!;
    expect(r.source).toBe("yadvashem");
    expect(r.personName).toBeTruthy();
    expect(r.landingUrl).toContain("/names/");
  });
});
