import { parseArcinsysDetail } from "../lib/arcinsys-parse";
import { parseArcinsysResults } from "../lib/arcinsys-results";
import { proxyConfigured, proxyFetchText } from "../lib/fetch-proxy";
import { UPSTREAM_CACHE_TTL } from "../lib/http";
import type { AdapterResult, ArchiveAdapter, ArchiveRecord, Ctx, PersonQuery } from "../types";

/**
 * Arcinsys (Hessen et al.) — on-demand search, no harvesting.
 *
 * Arcinsys search is a stateful Spring WebFlow: GET simpleSearch.action mints an executionId,
 * the search redirects to a result view, then JS loads the rows via ajax actions. That flow
 * can't be reduced to a stateless request, and Arcinsys throttles/《empty-blocks》 datacenter
 * IPs. So we drive it through the fetch-proxy's headless-Chromium render (`render=1`), which
 * runs the whole flow in a real browser on a non-blocked IP and returns the populated
 * "Trefferliste" HTML. We parse the result rows from that.
 *
 * `filter.searchTerm` is the same box the user types into; `archivalDescriptionId` in a hit
 * equals the `detailid=v<id>` permalink id.
 */
const INSTANCE_ORIGIN = "https://arcinsys.hessen.de";

export const arcinsysAdapter: ArchiveAdapter = {
  id: "arcinsys",
  label: "Arcinsys (HE)",
  role: "records",

  async search(q: PersonQuery, ctx: Ctx): Promise<AdapterResult> {
    const term = (q.name ?? "").trim();
    if (!term) return { records: [] };
    // The flow needs a real browser on a clean IP; without the proxy we can't reach it.
    if (!proxyConfigured(ctx.env)) return { records: [], degraded: true };

    const search = new URL(`${INSTANCE_ORIGIN}/arcinsys/simpleSearch_search.action`);
    search.searchParams.set("filter.searchTerm", term);
    search.searchParams.set("filter.selectedSearchArea", "ALL_ARCHIVES");

    const html = await proxyFetchText(ctx.env, search.toString(), {
      render: true,
      waitMs: 9000,
      cacheTtl: UPSTREAM_CACHE_TTL,
      signal: ctx.signal,
    });

    const all = parseArcinsysResults(html, INSTANCE_ORIGIN);
    return { records: all.slice(0, q.limit), total: all.length };
  },

  // Fetch a single record's full detail page (rich fields: person, life dates, Bestand).
  async getRecord(id: string, ctx: Ctx): Promise<ArchiveRecord | null> {
    if (!proxyConfigured(ctx.env)) return null;
    const url = `${INSTANCE_ORIGIN}/arcinsys/detailAction?detailid=v${id.replace(/^v/, "")}`;
    const html = await proxyFetchText(ctx.env, url, { cacheTtl: UPSTREAM_CACHE_TTL, signal: ctx.signal });
    return parseArcinsysDetail(html, url, id);
  },
};
