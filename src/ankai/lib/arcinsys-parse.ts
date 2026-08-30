import { decodeEntities } from "./xml";
import { excerpt } from "./text";
import type { ArchiveRecord } from "../types";

/**
 * Parse an Arcinsys detail page into a normalized record. Layout: Bootstrap rows where a
 * `.boldFont` label (duplicated across responsive breakpoints) is followed by its value.
 * We flatten to label→value pairs, then map the German archival labels we care about
 * (verified against live archival-description pages, e.g. Bestand 518 Wiedergutmachung).
 * HTMLRewriter would be ideal on-Worker, but harvesting runs in a Cron with the whole body
 * already in memory, so a tolerant regex flatten is simpler and adequate.
 */
export function parseArcinsysDetail(html: string, landingUrl: string, sourceId: string): ArchiveRecord | null {
  const title = firstTitle(html);
  const fields = extractFields(html);
  if (!title && Object.keys(fields).length === 0) return null;

  const pick = (...labels: string[]): string | undefined => {
    for (const l of labels) if (fields[l]) return fields[l];
    return undefined;
  };

  const reference = pick("Signatur", "Bestellsignatur", "Archivsignatur");
  const dateText = pick("Laufzeit", "Laufzeit (unscharf)");
  const bestand = pick("Bestand", "Bestandsname");
  const scope = pick("Enthält", "Enthält-Vermerk", "Darin", "Enthältvermerk");
  const personName = pick("Personenname", "Name", "Person");
  const birthDate = pick("Geburtsdatum");
  const birthPlace = pick("Geburtsort");
  const deathDate = pick("Sterbedatum", "Todesdatum");
  const deathPlace = pick("Sterbeort", "Todesort");

  // Provenance context for the role hint: fold in the holding, classification, title and the
  // person-record labels (a Personenname in a Bestand 518 file signals a Wiedergutmachung victim).
  const context = [bestand, fields["Klassifikation"], title, pick("Beruf"), scope].filter(Boolean).join(" ");

  return {
    source: "arcinsys",
    sourceId,
    title: pick("Titel") ?? title,
    personName,
    role: roleHintFromContext(context),
    birth: birthDate || birthPlace ? { date: birthDate, place: birthPlace } : undefined,
    death: deathDate || deathPlace ? { date: deathDate, place: deathPlace } : undefined,
    documentType: pick("Verzeichnungsstufe") ?? bestand,
    holdingInstitution: pick("Archiv", "Bezeichnung der Institution"),
    reference,
    landingUrl,
    preview: (scope || bestand) ? excerpt([scope, bestand].filter(Boolean).join(" · ")) : undefined,
    accessNote:
      [dateText ? `Laufzeit: ${dateText}` : null, scope, fields["Schutzfrist"] ? `Schutzfrist: ${fields["Schutzfrist"]}` : null]
        .filter(Boolean)
        .join(" · ") || undefined,
  };
}

/** Provenance-only hint from the holding/classification context — never a verdict (PLAN §6). */
export function roleHintFromContext(context: string): ArchiveRecord["role"] {
  const c = context.toLowerCase();
  if (/spruchkammer|entnazifizierung|nsdap|entschädigungsverfahren gegen|täter/.test(c)) return "perpetrator";
  if (/wiedergutmachung|rückerstattung|entschädigung|verfolgt|opfer|restitution|bestand 518/.test(c)) return "victim";
  return "unknown";
}

function firstTitle(html: string): string | undefined {
  const m = /<title>([^<]*)<\/title>/i.exec(html);
  if (!m) return undefined;
  const t = decodeEntities(m[1]!).replace(/\u00a0/g, " ").trim();
  return t.replace(/^Arcinsys \| (Detailseite:\s*)?/i, "").trim() || undefined;
}

/**
 * Flatten label→value pairs. Each data row renders the label twice (desktop + mobile) then
 * the value(s); we dedupe the label and join multi-line values.
 */
function extractFields(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const rowRe = /row mb-3 mb-sm-2([\s\S]*?)(?=row mb-3 mb-sm-2|dataBlock|<\/main|<footer|$)/g;
  for (const row of html.matchAll(rowRe)) {
    const texts = [...row[1]!.matchAll(/>([^<]{1,200})</g)]
      .map((m) => decodeEntities(m[1]!).replace(/\u00a0/g, " ").trim())
      .filter((t) => t.length > 0);
    if (texts.length < 2) continue;
    const label = texts[0]!;
    // Skip the repeated label, keep the rest as the value.
    const values = texts.slice(1).filter((t) => t !== label);
    if (label && values.length && !(label in fields)) fields[label] = values.join(" ");
  }
  return fields;
}
