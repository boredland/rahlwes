import { describe, expect, it } from "vitest";
import { linkOutProviders, providerCatalog, recordProviders, selectableSources } from "../../src/ankai/providers";

/**
 * Architecture guarantees for extensibility. These lock in the "one place to add a provider"
 * contract: if someone adds an adapter to the catalog, it must surface everywhere (catalog,
 * selectable sources) and stay internally consistent. They also guard the invariants that a
 * new provider must satisfy, so a malformed addition fails CI instead of shipping broken.
 */
describe("provider catalog", () => {
  it("exposes every record and link-out provider with a stable id + label", () => {
    for (const p of [...recordProviders, ...linkOutProviders]) {
      expect(p.id, "provider id").toBeTruthy();
      expect(p.label, `label for ${p.id}`).toBeTruthy();
    }
  });

  it("has unique ids across all providers (ids are the API/UI contract)", () => {
    const ids = providerCatalog.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("catalog = record + authority + link-out providers, nothing dropped", () => {
    expect(providerCatalog).toHaveLength(recordProviders.length + linkOutProviders.length);
    for (const a of recordProviders) expect(providerCatalog.find((p) => p.id === a.id)?.kind).toBe(a.role);
    for (const b of linkOutProviders) expect(providerCatalog.find((p) => p.id === b.id)?.kind).toBe("linkout");
  });

  it("selectable sources are exactly the non-link-out providers (what the UI toggles)", () => {
    expect(selectableSources.every((p) => p.kind !== "linkout")).toBe(true);
    expect(selectableSources).toHaveLength(recordProviders.length);
  });

  it("every record adapter satisfies the ArchiveAdapter contract used by the fan-out", () => {
    for (const a of recordProviders) {
      expect(typeof a.search, `${a.id}.search`).toBe("function");
      expect(["records", "authority"]).toContain(a.role);
    }
  });

  it("every link-out builder produces valid, absolute URLs for a populated query", () => {
    for (const b of linkOutProviders) {
      for (const link of b.build({ name: "Levi", keywords: "Frankfurt", limit: 20 })) {
        expect(() => new URL(link.url), `${b.id} url`).not.toThrow();
        expect(link.label).toBeTruthy();
      }
    }
  });
});
