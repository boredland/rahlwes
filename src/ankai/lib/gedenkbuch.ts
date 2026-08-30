import type { ArchiveRecord, AnkaiEnv } from "../types";

/**
 * Ingest a Bundesarchiv Gedenkbuch CSV export (Jewish victims of the Reich) into D1.
 * The Gedenkbuch is a stateful JSF app with no stable machine URL; its supported machine
 * path is the CSV export of a result set. This loader takes that CSV (delivered via the
 * admin ingest endpoint) and upserts victims as first-class records.
 *
 * Columns vary by export locale; we map by header name and tolerate absence.
 */
export async function ingestGedenkbuchCsv(env: AnkaiEnv, csv: string): Promise<number> {
  const rows = parseCsv(csv);
  if (rows.length < 2) return 0;
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i !== -1) return i;
    }
    return -1;
  };

  const iLast = col("nachname", "name", "last name", "surname");
  const iFirst = col("vorname", "first name", "given name");
  const iBirth = col("geburtsdatum", "date of birth", "geboren");
  const iBirthPlace = col("geburtsort", "place of birth");
  const iDeath = col("todesdatum", "sterbedatum", "date of death");
  const iFate = col("schicksal", "fate", "todesort", "deportation");

  let count = 0;
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r]!;
    const name = [at(cells, iFirst), at(cells, iLast)].filter(Boolean).join(" ").trim();
    if (!name) continue;
    const sourceId = `gb-${r}-${name.replace(/\s+/g, "_")}`.slice(0, 128);
    await env.ANKAI_DB.prepare(
      `INSERT INTO records
         (source, source_id, person_name, role, birth_date, birth_place, death_date, death_place,
          document_type, holding, reference, title, landing_url, access_note, updated_at)
       VALUES ('gedenkbuch',?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(source, source_id) DO UPDATE SET
         person_name=excluded.person_name, birth_date=excluded.birth_date, birth_place=excluded.birth_place,
         death_date=excluded.death_date, access_note=excluded.access_note, updated_at=excluded.updated_at`,
    )
      .bind(
        sourceId,
        name,
        "victim",
        at(cells, iBirth) || null,
        at(cells, iBirthPlace) || null,
        at(cells, iDeath) || null,
        at(cells, iFate) || null,
        "Gedenkbuch-Eintrag",
        "Bundesarchiv",
        null,
        name,
        "https://www.bundesarchiv.de/gedenkbuch/",
        at(cells, iFate) || null,
        new Date().toISOString(),
      )
      .run();
    count += 1;
  }
  return count;
}

const at = (cells: string[], i: number) => (i >= 0 ? (cells[i]?.trim() ?? "") : "");

/** Small RFC-4180-ish CSV parser: handles quoted fields, embedded commas/quotes/newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

