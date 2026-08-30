/**
 * Minimal, dependency-free XML tag reader for the narrow SRU/MODS/MARC shapes we consume.
 * Namespace-insensitive: matches local names regardless of prefix. Not a general parser —
 * good enough for the flat records SRU returns, and it streams no DOM onto the Worker.
 */

/** All text contents of `<local>…</local>` (prefix-agnostic), in document order. */
export function textValues(xml: string, local: string): string[] {
  const re = new RegExp(`<(?:[\\w.-]+:)?${local}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${local}>`, "g");
  const out: string[] = [];
  for (const m of xml.matchAll(re)) out.push(decodeEntities(m[1]!.trim()));
  return out;
}

/** First text content of `<local>`, or undefined. */
export function firstText(xml: string, local: string): string | undefined {
  return textValues(xml, local)[0];
}

/** Raw (un-decoded) inner XML of each `<local>…</local>` block — for blocks with child tags. */
export function rawBlocks(xml: string, local: string): string[] {
  const re = new RegExp(`<(?:[\\w.-]+:)?${local}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${local}>`, "g");
  const out: string[] = [];
  for (const m of xml.matchAll(re)) out.push(m[1]!);
  return out;
}

/** Named HTML entities that appear in the German archive pages we parse. */
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: "\u00a0",
  auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß",
  eacute: "é", egrave: "è", agrave: "à", ccedil: "ç",
  ndash: "–", mdash: "—", hellip: "…", laquo: "«", raquo: "»", middot: "·",
  quot: '"', apos: "'", lt: "<", gt: ">",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&([a-zA-Z]+);/g, (m, name: string) => NAMED_ENTITIES[name] ?? m)
    .replace(/&amp;/g, "&");
}
