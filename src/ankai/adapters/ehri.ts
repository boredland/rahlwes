import { fetchJson, UPSTREAM_CACHE_TTL } from "../lib/http";
import { excerpt } from "../lib/text";
import type { AdapterResult, ArchiveAdapter, ArchiveRecord, Ctx, PersonQuery } from "../types";

const BASE = "https://portal.ehri-project.eu/api/v1";

interface EhriDescription {
  name?: string;
  scopeAndContent?: string;
  unitDates?: { startDate?: string; endDate?: string }[];
}
interface EhriItem {
  id: string;
  type: string;
  attributes: {
    identifier?: string;
    repository?: string;
    descriptions?: EhriDescription[];
    [k: string]: unknown;
  };
  links?: { self?: string };
}
interface EhriResponse {
  data: EhriItem[];
  meta?: { total?: number };
  links?: { next?: string };
}

/**
 * EHRI (European Holocaust Research Infrastructure) — the centerpiece source.
 * JSON:API over archival descriptions (victims, camps, ghettos, deportations).
 * Cursor = the page number carried forward from links.next.
 */
export const ehriAdapter: ArchiveAdapter = {
  id: "ehri",
  label: "EHRI Portal",
  role: "records",

  async search(q: PersonQuery, ctx: Ctx): Promise<AdapterResult> {
    const terms = (q.name ?? "").trim();
    if (!terms) return { records: [] };

    const url = new URL(`${BASE}/search`);
    url.searchParams.set("q", terms);
    url.searchParams.set("type", "DocumentaryUnit");
    url.searchParams.set("limit", String(q.limit));
    if (q.cursor) url.searchParams.set("page", q.cursor);

    const headers: Record<string, string> = ctx.env.EHRI_TOKEN
      ? { authorization: `Bearer ${ctx.env.EHRI_TOKEN}` }
      : {};
    const body = await fetchJson<EhriResponse>(url.toString(), { headers }, ctx.signal, UPSTREAM_CACHE_TTL);

    const records = body.data.map((item) => toRecord(item));
    const nextPage = body.links?.next ? new URL(body.links.next).searchParams.get("page") : null;
    return { records, total: body.meta?.total, cursor: nextPage ?? undefined };
  },

  async getRecord(id: string, ctx: Ctx): Promise<ArchiveRecord | null> {
    try {
      const body = await fetchJson<{ data: EhriItem }>(`${BASE}/${id}`, {}, ctx.signal, UPSTREAM_CACHE_TTL);
      return toRecord(body.data);
    } catch {
      return null;
    }
  },
};

function toRecord(item: EhriItem): ArchiveRecord {
  const attrs = item.attributes;
  // Descriptive fields (name, scope & content) live inside descriptions[], one per language;
  // prefer the first with content. Top-level attributes only carry identifiers.
  const desc = attrs.descriptions?.find((d) => d.name || d.scopeAndContent) ?? attrs.descriptions?.[0];
  const scope = desc?.scopeAndContent?.trim() || undefined;
  return {
    source: "ehri",
    sourceId: item.id,
    title: desc?.name?.trim() || undefined,
    documentType: item.type,
    role: "unknown",
    holdingInstitution: typeof attrs.repository === "string" ? attrs.repository : undefined,
    reference: typeof attrs.identifier === "string" ? attrs.identifier : undefined,
    landingUrl: portalUrl(item.type, item.id),
    preview: scope ? excerpt(scope, 280) : undefined,
    accessNote: scope,
  };
}


/**
 * Map an EHRI item to its human-facing portal page. `links.self` is the JSON API URL, not
 * the browsable page, and the path segment differs by type (verified against the live
 * portal). Falls back to /units for unknown/future types.
 */
const PORTAL_PATH: Record<string, string> = {
  DocumentaryUnit: "units",
  Repository: "institutions",
  Country: "countries",
  HistoricalAgent: "authorities",
  CvocConcept: "keywords",
};

function portalUrl(type: string, id: string): string {
  const segment = PORTAL_PATH[type] ?? "units";
  return `https://portal.ehri-project.eu/${segment}/${id}`;
}
