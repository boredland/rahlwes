import { fetchText, UPSTREAM_CACHE_TTL } from "../lib/http";
import { decodeEntities } from "../lib/xml";
import type { Ctx } from "../types";

const BASE = "https://services.dnb.de/sru/authorities";

/**
 * Expand a personal name into GND-attested variants (preferred + cross-references), so a
 * search for "Levy" also matches "Levi"/"Lévy". Reads MARC21 datafields 100 (preferred
 * name) and 400 (variant names), subfield $a. Best-effort: returns the original name plus
 * any variants, deduped. Never throws into the request path — callers fall back to [name].
 */
export async function expandNameVariants(name: string, ctx: Ctx): Promise<string[]> {
  const url = new URL(BASE);
  url.searchParams.set("version", "1.1");
  url.searchParams.set("operation", "searchRetrieve");
  url.searchParams.set("query", `WOE=${name}`);
  url.searchParams.set("recordSchema", "MARC21-xml");
  url.searchParams.set("maximumRecords", "5");

  const xml = await fetchText(url.toString(), ctx.signal, { accept: "application/xml" }, UPSTREAM_CACHE_TTL);
  const variants = new Set<string>([name]);
  const datafield = /<(?:[\w.-]+:)?datafield\b[^>]*\btag="(100|400)"[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?datafield>/g;
  const subfieldA = /<(?:[\w.-]+:)?subfield\b[^>]*\bcode="a"[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?subfield>/;
  for (const field of xml.matchAll(datafield)) {
    const a = subfieldA.exec(field[2]!);
    if (a) variants.add(decodeEntities(a[1]!.trim()));
  }
  return [...variants];
}
