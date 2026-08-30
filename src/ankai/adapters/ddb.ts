import { fetchJson, UPSTREAM_CACHE_TTL } from "../lib/http";
import type { AdapterResult, ArchiveAdapter, ArchiveRecord, Ctx, PersonQuery } from "../types";

const BASE = "https://api.deutsche-digitale-bibliothek.de";

/** DDB Solr search envelope (subset we map). Fields are optional-tolerant by design. */
interface DdbDoc {
  id?: string;
  label?: string;
  subtitle?: string;
  type?: string;
  category?: string;
  provider?: string;
}
interface DdbResults {
  docs?: DdbDoc[];
}
interface DdbSearchResponse {
  numberOfResults?: number;
  nextCursorMark?: string;
  results?: DdbResults[];
}

/**
 * Deutsche Digitale Bibliothek + Archivportal-D (one index; sector_fct=sec_02 = archives).
 * Reaches Bundesarchiv, Landesarchive (restitution/denazification finding aids) and more.
 * Requires DDB_API_KEY. Uses Solr cursorMark for stable deep paging.
 */
export const ddbAdapter: ArchiveAdapter = {
  id: "ddb",
  label: "Deutsche Digitale Bibliothek / Archivportal-D",
  role: "records",

  async search(q: PersonQuery, ctx: Ctx): Promise<AdapterResult> {
    const key = ctx.env.DDB_API_KEY;
    if (!key) return { records: [], degraded: true };

    const terms = (q.name ?? "").trim();
    if (!terms) return { records: [] };

    const url = new URL(`${BASE}/search`);
    url.searchParams.set("query", terms);
    url.searchParams.set("sector_fct", "sec_02");
    url.searchParams.set("rows", String(q.limit));
    url.searchParams.set("cursorMark", q.cursor ?? "*");
    url.searchParams.set("sort", "id asc"); // cursorMark requires a deterministic sort
    url.searchParams.set("oauth_consumer_key", key);

    const body = await fetchJson<DdbSearchResponse>(url.toString(), {}, ctx.signal, UPSTREAM_CACHE_TTL);
    const docs = body.results?.flatMap((r) => r.docs ?? []) ?? [];
    const records = docs.filter((d) => d.id).map((d) => toRecord(d));
    // Stop paging when the cursor stops advancing (Solr convention).
    const cursor = body.nextCursorMark && body.nextCursorMark !== q.cursor ? body.nextCursorMark : undefined;
    return { records, total: body.numberOfResults, cursor };
  },
};

function toRecord(doc: DdbDoc): ArchiveRecord {
  return {
    source: "ddb",
    sourceId: doc.id!,
    title: doc.label,
    documentType: doc.type ?? doc.category,
    role: "unknown",
    holdingInstitution: doc.provider,
    landingUrl: `https://www.deutsche-digitale-bibliothek.de/item/${doc.id}`,
    preview: doc.subtitle?.trim() || undefined,
  };
}
