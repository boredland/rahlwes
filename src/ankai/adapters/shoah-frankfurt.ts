import { excerpt } from "../lib/text";
import type { AdapterResult, ArchiveAdapter, ArchiveRecord, Ctx, PersonQuery } from "../types";

const API = "https://memorial-api.metahubfrankfurt.de/api/memorial/de/biographies/search/";
const SITE = "https://www.shoah-memorial-frankfurt.de";

/**
 * Jewish Museum Frankfurt — Shoah memorial biographies. A per-person database of Frankfurt's
 * Nazi-persecution victims (birth/deportation/death, addresses, biography text).
 *
 * Backend (verified live): POST to the memorial REST API with a filter body; the site's
 * base64 `q` URL param just encodes this same structure. Reachable directly (no proxy). The
 * query goes in `filter.query`; paging via `limit`/`offset` query params. Detail pages live
 * at /biography/<slug>.
 */
export const shoahFrankfurtAdapter: ArchiveAdapter = {
  id: "shoah-ffm",
  label: "Shoah-Memorial Frankfurt",
  role: "records",

  async search(q: PersonQuery, ctx: Ctx): Promise<AdapterResult> {
    const term = (q.name ?? "").trim();
    if (!term) return { records: [] };

    const offset = q.cursor ? Number(q.cursor) : 0;
    const url = new URL(API);
    url.searchParams.set("limit", String(q.limit));
    url.searchParams.set("offset", String(offset));

    const body = {
      filter: { query: term, placeOfBirth: [], placeOfDeath: [], address: [], deportedTo: [], school: [], houseNumber: [] },
      sortOrder: "asc",
      sortBy: "relevance",
    };
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal: ctx.signal,
    });
    if (!res.ok) throw new Error(`shoah-ffm -> HTTP ${res.status}`);
    const data = (await res.json()) as ShoahResponse;

    const records = (data.results ?? []).map((r) => toRecord(r));
    const cursor = data.next ? String(offset + records.length) : undefined;
    return { records, total: data.count, cursor };
  },
};

interface ShoahBiography {
  id: number;
  slug?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  birthName?: string | null;
  birthDate?: string | null;
  placeOfBirth?: string | null;
  deathDate?: string | null;
  placeOfDeath?: string | null;
  deportedTo?: string[] | null;
  lastAddress?: string | null;
  biography?: string | null;
}
interface ShoahResponse {
  count?: number;
  next?: string | null;
  results?: ShoahBiography[];
}

function toRecord(b: ShoahBiography): ArchiveRecord {
  const deported = b.deportedTo?.length ? `deported: ${b.deportedTo.join(" → ")}` : null;
  const preview = [b.lastAddress ? `Frankfurt: ${b.lastAddress}` : null, deported, b.biography?.trim() || null]
    .filter(Boolean)
    .join(" · ");
  return {
    source: "shoah-ffm",
    sourceId: b.slug ?? String(b.id),
    personName: b.name ?? ([b.firstName, b.lastName].filter(Boolean).join(" ") || undefined),
    role: "victim",
    birth: b.birthDate || b.placeOfBirth ? { date: b.birthDate ?? undefined, place: b.placeOfBirth ?? undefined } : undefined,
    death: b.deathDate || b.placeOfDeath ? { date: b.deathDate ?? undefined, place: b.placeOfDeath ?? undefined } : undefined,
    documentType: "Shoah-Biografie",
    holdingInstitution: "Jüdisches Museum Frankfurt",
    landingUrl: b.slug ? `${SITE}/biography/${b.slug}` : `${SITE}/search`,
    preview: preview ? excerpt(preview) : undefined,
  };
}
