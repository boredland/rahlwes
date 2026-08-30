import type { LinkOutBuilder } from "../lib/gateway";
import type { LinkOut, PersonQuery } from "../types";

/**
 * Tier-3 sources have no usable/permitted API. Instead of scraping, we hand the researcher
 * a deep link into each source's own search, pre-filled from the query. Respectful and
 * lawful: the user completes the search on the source's site.
 */
export const linkOutBuilders: LinkOutBuilder[] = [
  {
    id: "matricula",
    label: "Matricula",
    build(q: PersonQuery): LinkOut[] {
      if (!q.keywords && !q.name) return [];
      const url = new URL("https://data.matricula-online.eu/en/suchen/");
      // Matricula searches parish records by place; use keywords as the place hint if given.
      if (q.keywords) url.searchParams.set("ort", q.keywords);
      return [
        {
          source: "matricula",
          label: "Matricula — church registers (baptism/marriage/death)",
          url: url.toString(),
          note: "Genealogical grounding via parish records.",
        },
      ];
    },
  },
  {
    id: "nara-nsdap",
    label: "NARA (NSDAP)",
    build(q: PersonQuery): LinkOut[] {
      if (!q.name) return [];
      const url = new URL("https://catalog.archives.gov/search");
      url.searchParams.set("q", `${q.name} NSDAP`);
      url.searchParams.set("f.materialsType", "microform");
      return [
        {
          source: "nara-nsdap",
          label: "NARA — NSDAP membership card files (BDC, series A3340)",
          url: url.toString(),
          note: "Perpetrator/membership source; films are indexed by series, not name.",
        },
      ];
    },
  },
];
