import { describe, expect, it } from "vitest";
import { keywordTokens, nameTokens, rankAcrossSources, scoreRecord } from "../../src/ankai/lib/relevance";
import type { ArchiveRecord, PersonQuery } from "../../src/ankai/types";

const rec = (p: Partial<ArchiveRecord>): ArchiveRecord => ({
  source: p.source ?? "x",
  sourceId: p.sourceId ?? "1",
  landingUrl: "https://example.org/1",
  ...p,
});

describe("token extraction", () => {
  it("name tokens include GND variants; keywords are separate", () => {
    const q: PersonQuery = { limit: 20, name: "Rene Weiß", keywords: "Frankfurt Rückerstattung", nameVariants: ["Weiss"] };
    expect(nameTokens(q)).toEqual(["rene", "weiss"]); // "Weiß" and variant "Weiss" fold to one token
    expect(keywordTokens(q)).toEqual(["frankfurt", "ruckerstattung"]); // umlaut folded
  });
});

describe("scoreRecord — where the name lands dominates", () => {
  const name = ["rene", "weiss"];

  it("ranks an adjacent name-phrase far above scattered words in content", () => {
    const phrase = scoreRecord(name, [], rec({ personName: "Rene Weiss" }));
    const reversed = scoreRecord(name, [], rec({ personName: "Weiss, Rene" }));
    const scattered = scoreRecord(name, [], rec({ personName: "Anna Weiss", preview: "letter to Rene Klein about the Weiss family" }));
    expect(phrase).toBeGreaterThan(scattered * 3);
    expect(reversed).toBeGreaterThan(scattered * 3);
    // "Weiss, Rene" (reversed order, adjacent) ranks as a phrase, same tier as "Rene Weiss"
    expect(Math.abs(phrase - reversed)).toBeLessThan(200);
  });

  it("ranks all-tokens-in-name above tokens-only-in-free-text", () => {
    const inName = scoreRecord(name, [], rec({ personName: "Rene Bruno Weiss" }));
    const inContent = scoreRecord(name, [], rec({ title: "Akte", preview: "betrifft Rene Klein und Herrn Weiss" }));
    expect(inName).toBeGreaterThan(inContent);
  });

  it("keywords add a boost but never outweigh a name-phrase hit", () => {
    const nameHit = scoreRecord(name, ["frankfurt"], rec({ personName: "Rene Weiss" }));
    const keywordOnly = scoreRecord(name, ["frankfurt"], rec({ personName: "Otto Müller", preview: "Frankfurt am Main" }));
    expect(nameHit).toBeGreaterThan(keywordOnly);
  });

  it("still matches Arolsen-style ?-garbled names", () => {
    expect(scoreRecord(["weiss"], [], rec({ personName: "Jost ?EISS" }))).toBeGreaterThan(0);
  });

  it("matches German spelling variants (ß↔ss, umlauts) so real records beat free-text hits", () => {
    // typed "weiss" must hit the record's "Weiß" as a full phrase, outscoring a title mention.
    const record = scoreRecord(["rene", "weiss"], [], rec({ personName: "Weiß, Rene" }));
    const titleMention = scoreRecord(["rene", "weiss"], [], rec({ title: "letters in name of Holz Ida, Weiss Rene" }));
    expect(record).toBeGreaterThan(titleMention);
    expect(scoreRecord(["muller"], [], rec({ personName: "Müller, Anna" }))).toBeGreaterThan(0);
  });

  it("scores zero when neither name nor keywords match", () => {
    expect(scoreRecord(name, ["frankfurt"], rec({ personName: "Chaia Aberman", preview: "Berlin" }))).toBe(0);
  });
});

describe("rankAcrossSources", () => {
  const q: PersonQuery = { limit: 20, name: "Rene Weiss" };

  it("puts a name-phrase hit first even when its source bucket is second", () => {
    const bucketA = [rec({ source: "a", sourceId: "a1", preview: "mentions Rene and Weiss separately" })];
    const bucketB = [rec({ source: "b", sourceId: "b1", personName: "Rene Weiss" })];
    const ranked = rankAcrossSources(q, [bucketA, bucketB]);
    expect(ranked[0]!.sourceId).toBe("b1");
  });

  it("keeps non-matching records at the tail in source order (never drops them)", () => {
    const bucket = [rec({ sourceId: "hit", personName: "Rene Weiss" }), rec({ sourceId: "miss", title: "unrelated" })];
    const ranked = rankAcrossSources(q, [bucket]);
    expect(ranked.map((r) => r.sourceId)).toEqual(["hit", "miss"]);
  });
});
