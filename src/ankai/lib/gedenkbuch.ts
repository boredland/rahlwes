import type { AnkaiEnv } from "../types";

/** Statements per D1 batch; one batch is one round trip. */
const INGEST_BATCH = 500;

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
  const iDeathPlace = col("todesort", "place of death");
  const iFate = col("schicksal", "fate", "deportation nach", "deportation");
  // The export leads with a link column; it is the only stable per-person identifier the
  // Gedenkbuch exposes, so entries deep-link to their own page rather than the search.
  const iLink = col("gedenkbucheintrag (link)", "gedenkbucheintrag", "link", "url");

  // Batched rather than awaited row by row: a surname search exports thousands of rows,
  // and one D1 round trip per row makes the upload scale with the network, not the data.
  const statement = env.ANKAI_DB.prepare(
    `INSERT INTO records
       (source, source_id, person_name, role, birth_date, birth_place, death_date, death_place,
        document_type, holding, reference, title, landing_url, access_note, updated_at)
     VALUES ('gedenkbuch',?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(source, source_id) DO UPDATE SET
       person_name=excluded.person_name, birth_date=excluded.birth_date, birth_place=excluded.birth_place,
       death_date=excluded.death_date, death_place=excluded.death_place, title=excluded.title,
       landing_url=excluded.landing_url, access_note=excluded.access_note, updated_at=excluded.updated_at`,
  );
  const updatedAt = new Date().toISOString();
  const bound: D1PreparedStatement[] = [];

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r]!;
    const name = [at(cells, iFirst), at(cells, iLast)].filter(Boolean).join(" ").trim();
    if (!name) continue;
    const link = at(cells, iLink);
    // The entry's own Gedenkbuch URL is the only identifier stable across exports; a row
    // number shifts with every different search, so keying on it duplicated people.
    // Without a link, name and birth date are the next best natural key.
    const sourceId = (link.match(/\/gedenkbuch\/([^/?#]+)/)?.[1] ?? `${name}|${at(cells, iBirth)}`).slice(0, 128);
    bound.push(
      statement.bind(
        sourceId,
        name,
        "victim",
        at(cells, iBirth) || null,
        at(cells, iBirthPlace) || null,
        at(cells, iDeath) || null,
        at(cells, iDeathPlace) || at(cells, iFate) || null,
        "Gedenkbuch-Eintrag",
        "Bundesarchiv",
        null,
        name,
        link || "https://www.bundesarchiv.de/gedenkbuch/",
        at(cells, iFate) || null,
        updatedAt,
      ),
    );
  }

  for (let i = 0; i < bound.length; i += INGEST_BATCH) {
    await env.ANKAI_DB.batch(bound.slice(i, i + INGEST_BATCH));
  }
  return bound.length;
}

const at = (cells: string[], i: number) => (i >= 0 ? (cells[i]?.trim() ?? "") : "");

/**
 * Pick the delimiter from the header line. The Bundesarchiv export is semicolon-separated
 * (a German Excel convention) while the parser's RFC-4180 default is a comma; guessing
 * wrong yields one cell per row and every column lookup silently misses.
 */
function detectDelimiter(text: string): string {
  const header = text.slice(0, text.search(/\r?\n/) + 1 || undefined)
  const semicolons = (header.match(/;/g) ?? []).length
  const commas = (header.match(/,/g) ?? []).length
  return semicolons > commas ? ';' : ','
}

/** Small RFC-4180-ish CSV parser: handles quoted fields, embedded commas/quotes/newlines. */
export function parseCsv(text: string, delimiter = detectDelimiter(text)): string[][] {
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
    else if (ch === delimiter) {
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

