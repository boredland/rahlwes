import { decodeEntities } from "./xml";
import { roleHintFromContext } from "./arcinsys-parse";
import type { ArchiveRecord } from "../types";

/**
 * Parse an Arcinsys "Trefferliste" (result list) HTML into records. Each hit is a table row
 * of 7 cells: [select, signature, title/person, Laufzeit, …, …, detail link], where the
 * detail link carries `archivalDescriptionId=<id>`. Verified against the live simple-search
 * result page (rendered via fetch-proxy). `archivalDescriptionId=<id>` ↔ `detailid=v<id>`.
 */
export function parseArcinsysResults(html: string, instanceOrigin: string): ArchiveRecord[] {
  const records: ArchiveRecord[] = [];
  const seen = new Set<string>();

  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)) {
    const inner = row[1]!;
    const id = /archivalDescriptionId=(\d+)/.exec(inner)?.[1];
    if (!id || seen.has(id)) continue;

    const cells = [...inner.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((m) => cellText(m[1]!));
    if (cells.length < 4) continue;
    seen.add(id);

    const [, signature, titleOrName, laufzeit] = cells;
    const title = titleOrName || signature;
    const context = `${signature ?? ""} ${title ?? ""}`;
    records.push({
      source: "arcinsys",
      sourceId: id,
      title: title || undefined,
      personName: looksLikePersonName(titleOrName) ? titleOrName : undefined,
      role: roleHintFromContext(context),
      documentType: "Verzeichnungseinheit",
      reference: signature || undefined,
      landingUrl: `${instanceOrigin}/arcinsys/showArchivalDescriptionDetails.action?archivalDescriptionId=${id}`,
      preview: [signature, laufzeit].filter(Boolean).join(" · ") || undefined,
      accessNote: laufzeit ? `Laufzeit: ${laufzeit}` : undefined,
    });
  }
  return records;
}

function cellText(cellHtml: string): string {
  return decodeEntities(cellHtml.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** Heuristic: Arcinsys person entries render as "Surname, Given" — a comma with letters both sides. */
function looksLikePersonName(text: string | undefined): boolean {
  return !!text && /^[^,]+,\s+\S/.test(text) && !/\d{4}/.test(text);
}
