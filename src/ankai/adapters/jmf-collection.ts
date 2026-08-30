import { decodeEntities } from "../lib/xml";
import { UPSTREAM_CACHE_TTL } from "../lib/http";
import type { AdapterResult, ArchiveAdapter, ArchiveRecord, Ctx, PersonQuery } from "../types";

const SITE = "https://sammlung.juedischesmuseum.de";
const SEARCH = `${SITE}/suche-in-der-sammlung-des-jüdischen-museums-frankfurt/`;

/**
 * Jewish Museum Frankfurt — collection (objects: posters, documents, ritual objects, art…).
 * No JSON API; the search page server-renders result cards. We fetch the search HTML directly
 * (works from a datacenter IP) and parse the `/objekt/<slug>/` cards (title + creator).
 * Complements the Shoah *biography* database with the museum's *material* holdings.
 */
export const jmfCollectionAdapter: ArchiveAdapter = {
  id: "jmf-collection",
  label: "Jüdisches Museum Frankfurt (Sammlung)",
  role: "records",

  async search(q: PersonQuery, ctx: Ctx): Promise<AdapterResult> {
    const term = (q.name ?? "").trim();
    if (!term) return { records: [] };

    const url = new URL(SEARCH);
    url.searchParams.set("search", term);
    const res = await fetch(url.toString(), {
      headers: { "user-agent": "Mozilla/5.0", accept: "text/html" },
      cf: { cacheTtl: UPSTREAM_CACHE_TTL, cacheEverything: true },
      signal: ctx.signal,
    });
    if (!res.ok) throw new Error(`jmf-collection -> HTTP ${res.status}`);

    const records = parseCollectionResults(await res.text());
    return { records: records.slice(0, q.limit), total: records.length };
  },
};

/** Parse the server-rendered object cards. Each is an `<a href=".../objekt/<slug>/">` block
 * containing `.object-card__title` and `.object-card__name` (creator). Deduped by slug. */
export function parseCollectionResults(html: string): ArchiveRecord[] {
  const records: ArchiveRecord[] = [];
  const seen = new Set<string>();
  const anchor = /<a\b[^>]*href="([^"]*\/objekt\/([^"/]+)\/?)"[^>]*>([\s\S]*?)<\/a>/g;

  for (const m of html.matchAll(anchor)) {
    const href = m[1]!;
    const slug = m[2]!;
    const inner = m[3]!;
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const title = classText(inner, "object-card__title");
    const creator = classText(inner, "object-card__name");
    if (!title) continue;
    records.push({
      source: "jmf-collection",
      sourceId: slug,
      title,
      personName: creator || undefined,
      role: "unknown",
      documentType: "Sammlungsobjekt",
      holdingInstitution: "Jüdisches Museum Frankfurt",
      landingUrl: href.startsWith("http") ? href : `${SITE}/objekt/${slug}/`,
      preview: creator || undefined,
    });
  }
  return records;
}

/** Text content following the first element carrying `class="…<cls>…"`, tags stripped. */
function classText(html: string, cls: string): string | undefined {
  const m = new RegExp(`class="[^"]*${cls}[^"]*"[^>]*>([\\s\\S]*?)<`, "i").exec(html);
  if (!m) return undefined;
  const text = decodeEntities(m[1]!.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  return text || undefined;
}
