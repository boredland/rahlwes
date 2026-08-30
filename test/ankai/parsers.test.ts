import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseArcinsysDetail, roleHintFromContext } from "../../src/ankai/lib/arcinsys-parse";
import { parseArcinsysResults } from "../../src/ankai/lib/arcinsys-results";
import { parseCollectionResults } from "../../src/ankai/adapters/jmf-collection";
import { parseCsv } from "../../src/ankai/lib/gedenkbuch";
import { expandNameVariants } from "../../src/ankai/lib/gnd";
import { firstText, rawBlocks, textValues } from "../../src/ankai/lib/xml";

describe("xml reader", () => {
  const doc = `<root><srw:numberOfRecords>7</srw:numberOfRecords>
    <mods><title>Brief an A.</title><namePart>Levi, Max</namePart><namePart>Recipient</namePart></mods>
    <mods><title>Zweiter</title></mods></root>`;

  it("reads first and all text values ignoring namespace prefixes", () => {
    expect(firstText(doc, "numberOfRecords")).toBe("7");
    expect(textValues(doc, "title")).toEqual(["Brief an A.", "Zweiter"]);
    expect(textValues(doc, "namePart")).toEqual(["Levi, Max", "Recipient"]);
  });

  it("splits repeating blocks for per-record iteration", () => {
    expect(rawBlocks(doc, "mods")).toHaveLength(2);
  });
});

describe("arcinsys role hint (provenance only)", () => {
  it("maps denazification context to perpetrator", () => {
    expect(roleHintFromContext("Spruchkammer Darmstadt, Entnazifizierung")).toBe("perpetrator");
  });
  it("maps restitution context to victim", () => {
    expect(roleHintFromContext("Wiedergutmachung / Rückerstattung")).toBe("victim");
  });
  it("defaults to unknown for neutral context", () => {
    expect(roleHintFromContext("Gemeinderechnungen 1900-1910")).toBe("unknown");
  });
});

describe("arcinsys detail parser (real fixture)", () => {
  const html = readFileSync(new URL("./fixtures/arcinsys-a1.html", import.meta.url).pathname, "utf8");
  const record = parseArcinsysDetail(html, "https://arcinsys.hessen.de/arcinsys/detailAction?detailid=a1", "a1");

  it("extracts a record with title and holding institution from live markup", () => {
    expect(record).not.toBeNull();
    expect(record!.source).toBe("arcinsys");
    expect(record!.sourceId).toBe("a1");
    expect(record!.title).toMatch(/Staatsarchiv Darmstadt/);
    expect(record!.landingUrl).toContain("detailid=a1");
  });
});

describe("arcinsys person record (Wiedergutmachung fixture)", () => {
  const html = readFileSync(new URL("./fixtures/arcinsys-v-person.html", import.meta.url).pathname, "utf8");
  const r = parseArcinsysDetail(html, "https://arcinsys.hessen.de/arcinsys/detailAction?detailid=v4267937", "v4267937");

  it("extracts the person name, life dates and a decoded title", () => {
    expect(r).not.toBeNull();
    expect(r!.personName).toBe("Weiß, Rene");
    expect(r!.birth).toEqual({ date: "1890-05-21", place: "Paris / Frankreich" });
    expect(r!.death).toEqual({ date: "1972-02-25", place: "Haifa / Israel" });
    // named HTML entities must be decoded (no raw &nbsp;/&szlig; leaking through)
    expect(r!.title).not.toMatch(/&(nbsp|szlig|auml);/);
    expect(r!.title).toContain("Weiß, Rene");
  });

  it("infers the victim role from the Wiedergutmachung provenance context", () => {
    expect(r!.role).toBe("victim");
  });
});

describe("csv parser", () => {
  it("handles quoted fields, embedded commas, quotes and newlines", () => {
    const rows = parseCsv('Nachname,Vorname,Ort\n"Levi","Max","Frankfurt, Main"\n"O""Neil",Anna,Berlin\n');
    expect(rows[0]).toEqual(["Nachname", "Vorname", "Ort"]);
    expect(rows[1]).toEqual(["Levi", "Max", "Frankfurt, Main"]);
    expect(rows[2]).toEqual(['O"Neil', "Anna", "Berlin"]);
  });

  it("reads the semicolon-separated Bundesarchiv export", () => {
    // The real Gedenkbuch export is semicolon-separated with a leading link column. Parsed
    // as comma-separated it yields one cell per row, every column lookup misses, and the
    // ingest silently stores nothing — so the delimiter is detected from the header.
    const header =
      "Gedenkbucheintrag (Link);Nachname;Künstlername/Pseudonym;Vorname;Geburtsname;Geburtsdatum;Geburtsort";
    const row = "https://www.bundesarchiv.de/gedenkbuch/en866687;Fleisch;;Sally;;08.10.1878;Frankfurt a. Main";
    const rows = parseCsv(`${header}\n${row}\n`);

    expect(rows[0]).toHaveLength(7);
    expect(rows[0]![1]).toBe("Nachname");
    expect(rows[1]![1]).toBe("Fleisch");
    expect(rows[1]![3]).toBe("Sally");
    expect(rows[1]![0]).toContain("/gedenkbuch/en866687");
  });
});

// Network-touching; opt-in via LIVE=1 so CI stays deterministic and offline.
describe.skipIf(!process.env.LIVE)("gnd name expansion (live)", () => {
  it("returns the original name plus attested variants", async () => {
    const ctx = { env: {} as never, signal: AbortSignal.timeout(15000) };
    const variants = await expandNameVariants("Einstein", ctx);
    expect(variants).toContain("Einstein");
    expect(variants.length).toBeGreaterThan(1);
  });
});

describe("arcinsys result-list parser (rendered search fixture)", () => {
  const html = readFileSync(new URL("./fixtures/arcinsys-results.html", import.meta.url).pathname, "utf8");
  const records = parseArcinsysResults(html, "https://arcinsys.hessen.de");

  it("parses all hit rows into records", () => {
    expect(records.length).toBeGreaterThanOrEqual(10);
  });

  it("extracts the Rene Weiß hit with id, name, reference and detail link", () => {
    const w = records.find((r) => r.sourceId === "4267937");
    expect(w).toBeDefined();
    expect(w!.personName).toBe("Weiß, Rene");
    expect(w!.reference).toBe("HHStAW, 518, 30396");
    expect(w!.landingUrl).toBe(
      "https://arcinsys.hessen.de/arcinsys/showArchivalDescriptionDetails.action?archivalDescriptionId=4267937",
    );
    expect(w!.preview).toContain("HHStAW, 518, 30396");
  });

  it("dedupes repeated ids and skips non-hit rows", () => {
    const ids = records.map((r) => r.sourceId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("Jewish Museum Frankfurt collection parser (fixture)", () => {
  const html = readFileSync(new URL("./fixtures/jmf-collection.html", import.meta.url).pathname, "utf8");
  const records = parseCollectionResults(html);

  it("parses object cards with title, creator and detail link", () => {
    expect(records.length).toBeGreaterThanOrEqual(2);
    const poster = records.find((r) => r.sourceId === "kinoplakat-the-diary-of-anne-frank");
    expect(poster).toBeDefined();
    expect(poster!.title).toBe("Kinoplakat The Diary of Anne Frank");
    expect(poster!.personName).toBe("Unbekannt");
    expect(poster!.landingUrl).toBe("https://sammlung.juedischesmuseum.de/objekt/kinoplakat-the-diary-of-anne-frank/");
    expect(poster!.source).toBe("jmf-collection");
  });

  it("dedupes repeated object cards by slug", () => {
    const ids = records.map((r) => r.sourceId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
