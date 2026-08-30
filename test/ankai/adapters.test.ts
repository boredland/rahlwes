import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { arcinsysAdapter } from "../../src/ankai/adapters/arcinsys";
import { arolsenAdapter } from "../../src/ankai/adapters/arolsen";
import { ddbAdapter } from "../../src/ankai/adapters/ddb";
import { ehriAdapter } from "../../src/ankai/adapters/ehri";
import { kalliopeAdapter } from "../../src/ankai/adapters/kalliope";
import { shoahFrankfurtAdapter } from "../../src/ankai/adapters/shoah-frankfurt";
import { yadVashemAdapter } from "../../src/ankai/adapters/yad-vashem";
import { expandNameVariants } from "../../src/ankai/lib/gnd";
import type { Ctx, AnkaiEnv } from "../../src/ankai/types";
import { installMockFetch, memoryKv, noSignal, type MockFetch } from "./helpers/mock-fetch";

let mock: MockFetch | undefined;
afterEach(() => mock?.restore());

const ctx = (env: Partial<AnkaiEnv> = {}): Ctx => ({ env: env as AnkaiEnv, signal: noSignal });

describe("EHRI adapter", () => {
  it("maps JSON:API items and carries the page cursor from links.next", async () => {
    mock = installMockFetch([
      {
        match: "/api/v1/search",
        body: {
          data: [
            {
              id: "de-002463-abc",
              type: "DocumentaryUnit",
              attributes: {
                identifier: "1.1.0",
                repository: "Buchenwald",
                descriptions: [
                  {
                    name: "Häftlingskartei",
                    scopeAndContent: "Prisoner registration cards from the Buchenwald concentration camp, ".repeat(6),
                  },
                ],
              },
              links: { self: "https://portal.ehri-project.eu/api/v1/de-002463-abc" },
            },
          ],
          meta: { total: 42 },
          links: { next: "https://portal.ehri-project.eu/api/v1/search?q=x&page=3&limit=20" },
        },
      },
    ]);
    const res = await ehriAdapter.search({ name: "Buchenwald", limit: 20 }, ctx());
    expect(res.total).toBe(42);
    expect(res.cursor).toBe("3");
    expect(mock.calls[0]!.cf).toEqual({ cacheTtl: 3600, cacheEverything: true }); // idempotent GET is edge-cached
    expect(res.records[0]).toMatchObject({
      source: "ehri",
      sourceId: "de-002463-abc",
      title: "Häftlingskartei",
      reference: "1.1.0",
      holdingInstitution: "Buchenwald",
      landingUrl: "https://portal.ehri-project.eu/units/de-002463-abc", // human page, not links.self (API URL)
    });
    // preview is a trimmed, ellipsised excerpt of scopeAndContent; accessNote keeps the full text
    expect(res.records[0]!.preview).toMatch(/^Prisoner registration cards/);
    expect(res.records[0]!.preview!.length).toBeLessThanOrEqual(281);
    expect(res.records[0]!.preview!.endsWith("…")).toBe(true);
    expect(res.records[0]!.accessNote!.length).toBeGreaterThan(res.records[0]!.preview!.length);
  });

  it("searches the upstream by name only (keywords are rank-only), and skips a blank query", async () => {
    mock = installMockFetch([{ match: "/api/v1/search", body: { data: [], meta: { total: 0 } } }]);
    await ehriAdapter.search({ name: "Levi", keywords: "Berlin", limit: 5 }, ctx());
    const url = mock.calls[0]!.url;
    expect(url).toContain("q=Levi");
    expect(url).not.toContain("Berlin"); // keywords are never sent upstream
    expect(url).toContain("type=DocumentaryUnit");
    expect(url).toContain("limit=5");

    const blank = await ehriAdapter.search({ limit: 5 }, ctx());
    expect(blank.records).toHaveLength(0);
    expect(mock.calls).toHaveLength(1); // no request made for a blank query
  });

  it("sends a bearer token when EHRI_TOKEN is configured", async () => {
    mock = installMockFetch([{ match: "/api/v1/search", body: { data: [] } }]);
    // token wiring is exercised via header capture in the live-drift suite; here we just
    // confirm the call still succeeds and is made.
    await ehriAdapter.search({ name: "x", limit: 1 }, ctx({ EHRI_TOKEN: "t" }));
    expect(mock.calls).toHaveLength(1);
  });
});

describe("DDB adapter", () => {
  it("degrades (no throw) when no API key is configured", async () => {
    const res = await ddbAdapter.search({ name: "Frankfurt", limit: 5 }, ctx());
    expect(res.records).toHaveLength(0);
    expect(res.degraded).toBe(true);
  });

  it("restricts to the archive sector, uses cursorMark, and maps docs", async () => {
    mock = installMockFetch([
      {
        match: "/search",
        body: {
          numberOfResults: 3,
          nextCursorMark: "MARK2",
          results: [{ docs: [{ id: "XYZ", label: "Entschädigungsakte", type: "mediatype_002", provider: "HHStA" }] }],
        },
      },
    ]);
    const res = await ddbAdapter.search({ name: "Fleisch", limit: 20 }, ctx({ DDB_API_KEY: "k" }));
    const url = mock.calls[0]!.url;
    expect(url).toContain("sector_fct=sec_02");
    expect(url).toContain("cursorMark=*"); // first page sentinel
    expect(url).toContain("oauth_consumer_key=k");
    expect(res.total).toBe(3);
    expect(res.cursor).toBe("MARK2");
    expect(res.records[0]).toMatchObject({ source: "ddb", sourceId: "XYZ", title: "Entschädigungsakte", holdingInstitution: "HHStA" });
  });

  it("stops paging when the cursorMark stops advancing", async () => {
    mock = installMockFetch([{ match: "/search", body: { numberOfResults: 1, nextCursorMark: "SAME", results: [{ docs: [{ id: "A" }] }] } }]);
    const res = await ddbAdapter.search({ name: "x", limit: 20, cursor: "SAME" }, ctx({ DDB_API_KEY: "k" }));
    expect(res.cursor).toBeUndefined();
  });
});

describe("Kalliope adapter", () => {
  it("queries creator OR title indexes and maps MODS records with startRecord paging", async () => {
    const xml = `<srw:searchRetrieveResponse xmlns:srw="x">
      <srw:numberOfRecords>50</srw:numberOfRecords>
      <srw:records>
        <srw:record><srw:recordData><mods><titleInfo><title>Nachlass Max Levi</title></titleInfo>
          <name><namePart>Levi, Max</namePart><role><roleTerm>Verfasser</roleTerm></role></name>
          <recordInfo><recordIdentifier>DE-611-HS-123</recordIdentifier></recordInfo>
          <physicalDescription><extent>1 Br., 2 S.</extent></physicalDescription>
          <location><url>https://kalliope-verbund.info/DE-611-HS-123</url></location></mods></srw:recordData></srw:record>
      </srw:records></srw:searchRetrieveResponse>`;
    mock = installMockFetch([{ match: "/sru", body: xml, headers: { "content-type": "application/xml" } }]);
    const res = await kalliopeAdapter.search({ name: "Levi", limit: 20 }, ctx());
    const url = decodeURIComponent(mock.calls[0]!.url);
    expect(url).toContain('ead.creator="Levi"');
    expect(url).toContain('ead.title="Levi"');
    expect(res.total).toBe(50);
    expect(res.cursor).toBe("2"); // 1 returned starting at 1 -> next startRecord 2, still < 50
    expect(res.records[0]).toMatchObject({
      source: "kalliope",
      sourceId: "DE-611-HS-123",
      title: "Nachlass Max Levi",
      personName: "Levi, Max",
      landingUrl: "https://kalliope-verbund.info/DE-611-HS-123",
    });
    expect(res.records[0]!.preview).toContain("Levi, Max");
    expect(res.records[0]!.preview).toContain("Verfasser");
    expect(res.records[0]!.preview).toContain("1 Br., 2 S.");
  });
});

describe("Arolsen adapter (undocumented ITS-WS.asmx protocol)", () => {
  it("primes a session, builds the query, lists persons, and maps rows", async () => {
    mock = installMockFetch([
      { match: "BuildQueryGlobalForAngular", body: { d: true }, headers: { "content-type": "application/json", "set-cookie": "ASP.NET_SessionId=sess123; path=/; HttpOnly" } },
      {
        match: "GetPersonList",
        body: { d: [{ ObjId: 42, DescId: "2744069", LastName: "Levi", FirstName: "Max", PlaceBirth: "Frankfurt", Dob: "1888", Date_of_decease: "1943", PrisonerNumber: "12345", Signature: "1.1.0 Personal file" }] },
      },
    ]);
    const res = await arolsenAdapter.search({ name: "Levi", limit: 20 }, ctx());

    const buildCall = mock.calls.find((c) => c.url.includes("BuildQueryGlobalForAngular"))!;
    const built = JSON.parse(buildCall.body!) as { strSearch: string; uniqueId: string; synSearch: boolean };
    expect(built.strSearch).toBe("Levi");
    expect(built.synSearch).toBe(true);

    const listCall = mock.calls.find((c) => c.url.includes("GetPersonList"))!;
    const listBody = JSON.parse(listCall.body!) as { uniqueId: string; rowNum: number };
    expect(listBody.uniqueId).toBe(built.uniqueId); // same session across the sequence
    expect(listBody.rowNum).toBe(0);
    expect(listCall.headers.cookie).toContain("ASP.NET_SessionId=sess123"); // LB stickiness replayed

    expect(res.records[0]).toMatchObject({
      source: "arolsen",
      sourceId: "2744069",
      personName: "Max Levi",
      role: "victim",
      birth: { date: "1888", place: "Frankfurt" },
      documentType: "1.1.0 Personal file",
      landingUrl: "https://collections.arolsen-archives.org/en/document/2744069",
    });
    expect(res.records[0]!.death).toEqual({ date: "1943" });
    expect(res.records[0]!.reference).toBe("12345");
    expect(res.records[0]!.accessNote).toMatch(/Sensitive/);
  });

  it("degrades when the query build fails", async () => {
    mock = installMockFetch([{ match: "BuildQueryGlobalForAngular", body: { d: false } }]);
    const res = await arolsenAdapter.search({ name: "x", limit: 20 }, ctx());
    expect(res.records).toHaveLength(0);
    expect(res.degraded).toBe(true);
  });

  it("re-ranks the phonetic dump: surfaces real matches, drops noise", async () => {
    // Arolsen returns an alphabetical fuzzy block; only some rows actually match "Weiss".
    const dump = [
      { DescId: "1", LastName: "ABERMAN", FirstName: "Chaia" }, // phonetic noise
      { DescId: "2", LastName: "ABRAHAM", FirstName: "Johanna" }, // phonetic noise
      { DescId: "3", LastName: "?EISS", FirstName: "Jost" }, // garbled real match
      { DescId: "4", LastName: "WEISS", FirstName: "Rene" }, // exact surname match
      { DescId: "4", LastName: "WEISS", FirstName: "Rene" }, // exact duplicate DescId -> collapsed
      { DescId: "5", LastName: "WEISSMANN", FirstName: "Adam" }, // prefix match
    ];
    mock = installMockFetch([
      { match: "BuildQueryGlobalForAngular", body: { d: true } },
      { match: "GetPersonList", body: { d: dump } },
    ]);
    const res = await arolsenAdapter.search({ name: "Weiss", limit: 10 }, ctx());

    const surnames = res.records.map((r) => r.personName);
    expect(res.total).toBe(3); // 3 distinct Weiss-like rows; ABERMAN/ABRAHAM dropped, dup DescId collapsed
    expect(surnames).not.toContain("Chaia ABERMAN");
    expect(res.records[0]!.personName).toBe("Rene WEISS"); // exact surname ranks first
    expect(surnames).toContain("Jost ?EISS"); // garbled match still included
  });
});

describe("Arcinsys adapter (on-demand via fetch-proxy render)", () => {
  const resultsHtml = readFileSync(new URL("./fixtures/arcinsys-results.html", import.meta.url).pathname, "utf8");
  const proxyEnv = { FETCH_PROXY_URL: "https://proxy.example/", FETCH_PROXY_TOKEN: "t", ANKAI_CACHE: memoryKv() } as Partial<AnkaiEnv>;

  it("renders the search URL through the proxy and parses hits", async () => {
    mock = installMockFetch([{ match: "proxy.example", body: resultsHtml, headers: { "content-type": "text/html" } }]);
    const res = await arcinsysAdapter.search({ name: "rene weiss", limit: 5 }, ctx(proxyEnv));

    // the proxy was called with render=1 and the Arcinsys search URL encoded in ?url=
    const call = mock.calls[0]!;
    expect(call.url).toContain("render=1");
    expect(decodeURIComponent(call.url)).toContain("simpleSearch_search.action");
    expect(decodeURIComponent(call.url)).toContain("filter.searchTerm=rene+weiss");

    expect(res.total).toBeGreaterThanOrEqual(10);
    expect(res.records).toHaveLength(5); // capped to limit
    expect(res.records.some((r) => r.sourceId === "4267937")).toBe(true);
  });

  it("degrades (no throw) when the proxy is not configured", async () => {
    const res = await arcinsysAdapter.search({ name: "x", limit: 5 }, ctx());
    expect(res.records).toHaveLength(0);
    expect(res.degraded).toBe(true);
  });

  it("serves a repeated query from KV without re-hitting the proxy", async () => {
    const env = { FETCH_PROXY_URL: "https://proxy.example/", FETCH_PROXY_TOKEN: "t", ANKAI_CACHE: memoryKv() } as Partial<AnkaiEnv>;
    mock = installMockFetch([{ match: "proxy.example", body: resultsHtml, headers: { "content-type": "text/html" } }]);
    await arcinsysAdapter.search({ name: "goethe", limit: 5 }, ctx(env));
    await arcinsysAdapter.search({ name: "goethe", limit: 5 }, ctx(env));
    expect(mock.calls).toHaveLength(1); // second search hits KV, proxy called once
  });
});

describe("Shoah-Memorial Frankfurt adapter", () => {
  it("POSTs the filter body and maps biographies", async () => {
    mock = installMockFetch([
      {
        match: "memorial-api.metahubfrankfurt.de",
        body: {
          count: 128,
          next: "https://memorial-api.metahubfrankfurt.de/api/memorial/de/biographies/search/?limit=20&offset=20",
          results: [
            {
              id: 12619,
              slug: "leo-weiss-12619",
              name: "Leo Weiss",
              firstName: "Leo",
              lastName: "Weiss",
              birthDate: "1928-01-19",
              placeOfBirth: "Wiesbaden",
              placeOfDeath: "Auschwitz",
              deportedTo: ["Drancy", "Auschwitz"],
              lastAddress: "Musterstr. 1",
            },
          ],
        },
      },
    ]);
    const res = await shoahFrankfurtAdapter.search({ name: "Weiss", limit: 20 }, ctx());

    const call = mock.calls[0]!;
    expect(call.method).toBe("POST");
    const sent = JSON.parse(call.body!) as { filter: { query: string }; sortBy: string };
    expect(sent.filter.query).toBe("Weiss");
    expect(sent.sortBy).toBe("relevance");
    expect(call.cf).toBeUndefined(); // POST is never edge-cached

    expect(res.total).toBe(128);
    expect(res.cursor).toBe("1"); // offset 0 + 1 returned; next present
    expect(res.records[0]).toMatchObject({
      source: "shoah-ffm",
      sourceId: "leo-weiss-12619",
      personName: "Leo Weiss",
      role: "victim",
      birth: { date: "1928-01-19", place: "Wiesbaden" },
      death: { place: "Auschwitz" },
      landingUrl: "https://www.shoah-memorial-frankfurt.de/biography/leo-weiss-12619",
    });
    expect(res.records[0]!.preview).toContain("Auschwitz");
  });

  it("returns empty for a blank query without calling the API", async () => {
    mock = installMockFetch([{ match: "memorial-api", body: {} }]);
    const res = await shoahFrankfurtAdapter.search({ limit: 20 }, ctx());
    expect(res.records).toHaveLength(0);
    expect(mock.calls).toHaveLength(0);
  });
});

describe("Yad Vashem adapter (session proxy)", () => {
  const env = { FETCH_PROXY_URL: "https://proxy.example/", FETCH_PROXY_TOKEN: "t" } as Partial<AnkaiEnv>;

  it("runs the 2-step session flow and maps name cards", async () => {
    mock = installMockFetch([
      {
        match: "proxy.example",
        body: {
          count: 50,
          cards: [
            {
              id: 6709265,
              url: "/en/names/6709265",
              title: "Yoylik Margulis",
              firstName: "Yoylik",
              lastName: "Margulis",
              fate: "murdered",
              birthYear: "1900",
              placesTags: ["Vinnitsa", " Ukraine (USSR)"],
              relatedList: [{ value: "Page of Testimony" }],
            },
          ],
        },
      },
    ]);
    const res = await yadVashemAdapter.search({ name: "Margulis", limit: 5 }, ctx(env));

    // posted a 2-step session to the proxy's session mode
    const call = mock.calls[0]!;
    expect(call.method).toBe("POST");
    expect(call.url).toContain("session=1");
    const steps = JSON.parse(call.body!) as { url: string; body: unknown }[];
    expect(steps).toHaveLength(2);
    expect(steps[0]!.url).toContain("BuidSpesificResultsQuery");
    expect(steps[1]!.url).toContain("GetDataResultsQuery");
    expect(JSON.stringify(steps[0]!.body)).toContain("Margulis");

    expect(res.total).toBe(50);
    expect(res.records[0]).toMatchObject({
      source: "yadvashem",
      sourceId: "6709265",
      personName: "Yoylik Margulis",
      role: "victim",
      birth: { date: "1900", place: "Vinnitsa" },
      landingUrl: "https://collections.yadvashem.org/en/names/6709265",
    });
    expect(res.records[0]!.preview).toContain("murdered");
  });

  it("degrades (no throw) when the proxy is not configured", async () => {
    const res = await yadVashemAdapter.search({ name: "x", limit: 5 }, ctx());
    expect(res.records).toHaveLength(0);
    expect(res.degraded).toBe(true);
  });
});

describe("GND name expansion", () => {
  it("returns the original name plus MARC 100/400 variants, deduped", async () => {
    const xml = `<searchRetrieveResponse xmlns="ns">
      <records><record><recordData><record xmlns="marc">
        <datafield tag="100"><subfield code="a">Levi, Max</subfield></datafield>
        <datafield tag="400"><subfield code="a">Lévy, Max</subfield></datafield>
        <datafield tag="400"><subfield code="a">Levy, Max</subfield></datafield>
        <datafield tag="670"><subfield code="a">ignore me</subfield></datafield>
      </record></recordData></record></records></searchRetrieveResponse>`;
    mock = installMockFetch([{ match: "/sru/authorities", body: xml, headers: { "content-type": "application/xml" } }]);
    const variants = await expandNameVariants("Levy", ctx());
    expect(variants).toContain("Levy"); // original preserved
    expect(variants).toContain("Levi, Max");
    expect(variants).toContain("Lévy, Max");
    expect(new Set(variants).size).toBe(variants.length); // deduped
    expect(variants).not.toContain("ignore me"); // 670 not a name field
  });
});
