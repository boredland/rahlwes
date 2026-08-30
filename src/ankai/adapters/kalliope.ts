import { fetchText, UPSTREAM_CACHE_TTL } from "../lib/http";
import { firstText, rawBlocks, textValues } from "../lib/xml";
import { excerpt } from "../lib/text";
import type { AdapterResult, ArchiveAdapter, ArchiveRecord, Ctx, PersonQuery } from "../types";

const BASE = "https://kalliope-verbund.info/sru";

/**
 * Kalliope — union catalog of personal papers, estates and autographs (Nachlässe).
 * Often the only archival trace of an individual. SRU 1.2 / CQL, MODS records.
 * Paging via startRecord (1-based); cursor carries the next startRecord.
 */
export const kalliopeAdapter: ArchiveAdapter = {
  id: "kalliope",
  label: "Kalliope-Verbund",
  role: "records",

  async search(q: PersonQuery, ctx: Ctx): Promise<AdapterResult> {
    if (!q.name) return { records: [] };

    const start = q.cursor ? Number(q.cursor) : 1;
    const url = new URL(BASE);
    url.searchParams.set("version", "1.2");
    url.searchParams.set("operation", "searchRetrieve");
    url.searchParams.set("query", `ead.creator="${q.name}" or ead.title="${q.name}"`);
    url.searchParams.set("recordSchema", "mods");
    url.searchParams.set("maximumRecords", String(q.limit));
    url.searchParams.set("startRecord", String(start));

    const xml = await fetchText(url.toString(), ctx.signal, { accept: "application/xml" }, UPSTREAM_CACHE_TTL);
    const total = Number(firstText(xml, "numberOfRecords") ?? "0");
    const records = rawBlocks(xml, "recordData").map((r) => toRecord(r));

    const nextStart = start + records.length;
    const cursor = records.length > 0 && nextStart <= total ? String(nextStart) : undefined;
    return { records, total, cursor };
  },
};

function toRecord(mods: string): ArchiveRecord {
  const identifier = firstText(mods, "recordIdentifier") ?? crypto.randomUUID();
  const title = firstText(mods, "title");
  const nameParts = textValues(mods, "namePart");
  const roles = textValues(mods, "roleTerm").filter((r) => r.length > 1);
  const extent = firstText(mods, "extent");
  const url = firstText(mods, "url");
  // No abstract in Kalliope MODS; compose a preview from the people/roles and physical extent.
  const previewParts = [nameParts.length ? nameParts.join("; ") : null, roles.length ? roles.join(", ") : null, extent];
  const preview = previewParts.filter(Boolean).join(" · ");
  return {
    source: "kalliope",
    sourceId: identifier,
    title,
    personName: nameParts[0],
    documentType: "Nachlass/Autograph",
    role: "unknown",
    reference: identifier,
    landingUrl: url ?? `https://kalliope-verbund.info/${identifier}`,
    preview: preview ? excerpt(preview) : undefined,
  };
}
