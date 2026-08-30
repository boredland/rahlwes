import { rankAcrossSources } from "./relevance";
import type {
  AdapterResult,
  ArchiveAdapter,
  Ctx,
  AnkaiEnv,
  LinkOut,
  PersonQuery,
  SearchResponse,
} from "../types";

/** Opaque gateway cursor: per-source cursors packed into one base64 token. */
export function encodeCursor(perSource: Record<string, string>): string {
  return btoa(JSON.stringify(perSource));
}

export function decodeCursor(cursor: string | undefined): Record<string, string> {
  if (!cursor) return {};
  try {
    const parsed = JSON.parse(atob(cursor)) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export interface LinkOutBuilder {
  id: string;
  label: string;
  build(q: PersonQuery): LinkOut[];
}

export interface FanOutDeps {
  adapters: ArchiveAdapter[];
  linkOutBuilders: LinkOutBuilder[];
  timeoutMs: number;
}

/**
 * Fan a query out to every record/authority adapter concurrently. One slow or failing
 * upstream never sinks the request: each adapter gets its own AbortController + timeout,
 * failures land in perSource.ok=false, and results/linkouts still return 200.
 */
export async function fanOut(
  query: PersonQuery,
  env: AnkaiEnv,
  deps: FanOutDeps,
): Promise<SearchResponse> {
  const cursors = decodeCursor(query.cursor);
  const perSource: SearchResponse["perSource"] = {};
  const nextCursors: Record<string, string> = {};

  const searchable = deps.adapters.filter((a) => a.role !== "linkout");
  const settled = await Promise.allSettled(
    searchable.map((adapter) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
      const ctx: Ctx = { env, signal: controller.signal };
      const scoped: PersonQuery = { ...query, cursor: cursors[adapter.id] };
      return adapter
        .search(scoped, ctx)
        .finally(() => clearTimeout(timer))
        .then((result): [ArchiveAdapter, AdapterResult] => [adapter, result]);
    }),
  );

  const results: SearchResponse["results"] = [];
  const byAdapter: ArchiveResultBucket[] = [];
  for (let i = 0; i < settled.length; i++) {
    const outcome = settled[i]!;
    const adapter = searchable[i]!;
    if (outcome.status === "fulfilled") {
      const [, result] = outcome.value;
      perSource[adapter.id] = {
        ok: true,
        total: result.total,
        returned: result.records.length,
        cursor: result.cursor,
        stale: result.degraded,
      };
      if (result.cursor) nextCursors[adapter.id] = result.cursor;
      byAdapter.push({ records: result.records });
    } else {
      const reason = outcome.reason;
      perSource[adapter.id] = {
        ok: false,
        error: reason instanceof Error ? reason.message : String(reason),
      };
      byAdapter.push({ records: [] });
    }
  }

  // Rank across all sources on one uniform relevance scale (upstream scores aren't
  // comparable), with a round-robin tiebreak so no single source dominates a relevance band.
  results.push(...rankAcrossSources(query, byAdapter.map((b) => b.records)));

  const linkouts = deps.linkOutBuilders.flatMap((b) => b.build(query));
  const cursor = Object.keys(nextCursors).length ? encodeCursor(nextCursors) : undefined;
  return { query: { ...query, cursor }, results, linkouts, perSource };
}

interface ArchiveResultBucket {
  records: SearchResponse["results"];
}
