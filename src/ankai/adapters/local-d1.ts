import type { AdapterResult, ArchiveAdapter, ArchiveRecord, Ctx, PersonQuery } from "../types";

interface RecordRow {
  source: string;
  source_id: string;
  person_name: string | null;
  role: string | null;
  birth_date: string | null;
  birth_place: string | null;
  death_date: string | null;
  death_place: string | null;
  document_type: string | null;
  holding: string | null;
  reference: string | null;
  title: string | null;
  landing_url: string;
  access_note: string | null;
}

/**
 * Adapter over locally harvested/ingested records in D1 (FTS5). One factory serves both
 * Arcinsys (harvested) and Gedenkbuch (ingested): same table, filtered by `source`.
 * Querying D1 keeps request latency low and leaves the upstreams untouched at request time.
 */
export function createD1Adapter(source: string, label: string): ArchiveAdapter {
  return {
    id: source,
    label,
    role: "records",

    async search(q: PersonQuery, ctx: Ctx): Promise<AdapterResult> {
      const terms = (q.name ?? "").trim();
      if (!terms) return { records: [] };

      const offset = q.cursor ? Number(q.cursor) : 0;
      const match = toFtsQuery(terms);

      const countRow = await ctx.env.ANKAI_DB.prepare(
        "SELECT COUNT(*) AS n FROM records_fts JOIN records ON records.rowid = records_fts.rowid " +
          "WHERE records.source = ? AND records_fts MATCH ?",
      )
        .bind(source, match)
        .first<{ n: number }>();

      const rs = await ctx.env.ANKAI_DB.prepare(
        "SELECT records.* FROM records_fts JOIN records ON records.rowid = records_fts.rowid " +
          "WHERE records.source = ? AND records_fts MATCH ? " +
          "ORDER BY rank LIMIT ? OFFSET ?",
      )
        .bind(source, match, q.limit, offset)
        .all<RecordRow>();

      const records = rs.results.map((row) => toRecord(row));
      const total = countRow?.n ?? records.length;
      const next = offset + records.length;
      return { records, total, cursor: next < total ? String(next) : undefined };
    },
  };
}

/** Turn user terms into a safe FTS5 prefix query: quote each token, OR them, allow prefixes. */
function toFtsQuery(terms: string): string {
  const tokens = terms.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (tokens.length === 0) return '""';
  return tokens.map((t) => `"${t}"*`).join(" ");
}

function toRecord(row: RecordRow): ArchiveRecord {
  return {
    source: row.source,
    sourceId: row.source_id,
    personName: row.person_name ?? undefined,
    role: (row.role as ArchiveRecord["role"]) ?? undefined,
    birth: row.birth_date || row.birth_place ? { date: row.birth_date ?? undefined, place: row.birth_place ?? undefined } : undefined,
    death: row.death_date || row.death_place ? { date: row.death_date ?? undefined, place: row.death_place ?? undefined } : undefined,
    documentType: row.document_type ?? undefined,
    holdingInstitution: row.holding ?? undefined,
    reference: row.reference ?? undefined,
    title: row.title ?? undefined,
    landingUrl: row.landing_url,
    preview: row.access_note ?? undefined,
    accessNote: row.access_note ?? undefined,
  };
}
