import { proxyConfigured, proxySession } from "../lib/fetch-proxy";
import { excerpt } from "../lib/text";
import type { AdapterResult, ArchiveAdapter, ArchiveRecord, Ctx, PersonQuery } from "../types";

const ORIGIN = "https://collections.yadvashem.org";
const API = `${ORIGIN}/api/Search`;
const SITE = "https://collections.yadvashem.org";

/**
 * Yad Vashem — Central Database of Shoah Victims' Names. The definitive victim-names
 * authority (Pages of Testimony, deportation lists, etc.).
 *
 * Its search is a stateful two-call flow behind a datacenter-IP block, so neither a direct
 * fetch nor a single proxied request works. We drive it through the fetch-proxy's session
 * mode (both calls in one browser context, shared cookie jar, non-blocked IP):
 *   1. BuidSpesificResultsQuery?tabName=victim — registers the name query in the session.
 *   2. GetDataResultsQuery?...&cardType=namesCard&tabName=other — reads the filtered results.
 * (Verified live: surname "Rosenzweig" returns real name cards, not the unfiltered default.)
 */
export const yadVashemAdapter: ArchiveAdapter = {
  id: "yadvashem",
  label: "Yad Vashem — Shoah Names",
  role: "records",

  async search(q: PersonQuery, ctx: Ctx): Promise<AdapterResult> {
    if (!q.name) return { records: [] };
    if (!proxyConfigured(ctx.env)) return { records: [], degraded: true };

    // The site splits the typed name across first/last; we don't know which is which, so
    // put the whole term in the last-name/maiden field (yvSynonym also catches first names).
    const build = [
      { fieldsNames: ["first_name_search_en"], valueToSearch: "", searchType: "yvSynonym", useLang: false, queryOperator: 1 },
      { fieldsNames: ["last_name_search_en", "maiden_name_search_en"], valueToSearch: q.name, searchType: "yvSynonym", useLang: false, queryOperator: 1 },
      { fieldsNames: ["place_birth_search_en", "place_war_search_en", "place_death_search_en", "place_permanent_search_en"], valueToSearch: "", searchType: "yvSynonym", useLang: false, queryOperator: 1 },
    ];
    const readBody = {
      queryOperator: 0,
      filters: { logicOperator: 0, filters: [{ fieldName: "data_bank", filterType: 0, filterOperator: 0, values: ["names"] }] },
      currentTab: { id: "tab_type", value: "names" },
    };
    const offset = q.cursor ? Number(q.cursor) : 0;
    const page = Math.floor(offset / q.limit) + 1;

    const result = await proxySession<YadVashemResults>(
      ctx.env,
      ORIGIN,
      [
        { url: `${API}/BuidSpesificResultsQuery?tabName=victim`, method: "POST", body: build },
        {
          url: `${API}/GetDataResultsQuery?valueToSearch=null&pageNumber=${page}&pageSize=${q.limit}&lang=en&cardType=namesCard&tabName=other`,
          method: "POST",
          body: readBody,
        },
      ],
      ctx.signal,
    );

    const cards = result?.cards ?? [];
    const records = cards.map((c) => toRecord(c));
    const total = result?.count;
    const cursor = total !== undefined && offset + records.length < total ? String(offset + q.limit) : undefined;
    return { records, total, cursor };
  },
};

interface YadVashemCard {
  id: string | number;
  url?: string;
  title?: string;
  firstName?: string;
  lastName?: string;
  fate?: string;
  birthYear?: string;
  placesTags?: string[];
  relatedList?: { value?: string }[];
}
interface YadVashemResults {
  count?: number;
  cards?: YadVashemCard[];
}

function toRecord(c: YadVashemCard): ArchiveRecord {
  const places = (c.placesTags ?? []).map((p) => p.trim()).filter(Boolean);
  const sourceType = c.relatedList?.[0]?.value;
  const preview = [c.fate ? `Fate: ${c.fate}` : null, places.length ? places.join(", ") : null, sourceType]
    .filter(Boolean)
    .join(" · ");
  return {
    source: "yadvashem",
    sourceId: String(c.id),
    personName: c.title ?? ([c.firstName, c.lastName].filter(Boolean).join(" ") || undefined),
    role: "victim",
    birth: c.birthYear ? { date: c.birthYear, place: places[0] } : undefined,
    documentType: sourceType ?? "Shoah victim record",
    holdingInstitution: "Yad Vashem",
    landingUrl: c.url ? `${SITE}${c.url}` : `${SITE}/en/names/${c.id}`,
    preview: preview ? excerpt(preview) : undefined,
  };
}
