import { linkOutProviders, recordProviders } from "../providers";
import type { Ctx, AnkaiEnv, PersonQuery, SearchResponse } from "../types";
import { fanOut } from "./gateway";
import { expandNameVariants } from "./gnd";

export interface SearchParams {
  name?: string;
  keywords?: string;
  birthYear?: number;
  deathYear?: number;
  limit?: number;
  cursor?: string;
  sources?: string;
  expandNames?: boolean;
}

/** Resolve the configured fan-out timeout (ms), defaulting to 4s. */
export function timeoutMs(env: AnkaiEnv): number {
  const n = Number(env.GATEWAY_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 4000;
}

/**
 * One place both the JSON API and the UI call: optional GND name expansion, source
 * selection, then the concurrent fan-out. Keeps `/v1/persons/search` and the search page
 * behaviourally identical.
 */
export async function runSearch(params: SearchParams, env: AnkaiEnv): Promise<SearchResponse> {
  const query: PersonQuery = {
    name: params.name,
    keywords: params.keywords,
    birthYear: year(params.birthYear),
    deathYear: year(params.deathYear),
    limit: boundedLimit(params.limit),
    cursor: params.cursor,
  };

  if (params.expandNames && query.name) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs(env));
    const ctx: Ctx = { env, signal: controller.signal };
    try {
      query.nameVariants = await expandNameVariants(query.name, ctx);
    } catch {
      query.nameVariants = [query.name];
    } finally {
      clearTimeout(timer);
    }
  }

  // Only record sources are filtered by the toggle set; link-outs are always offered,
  // since a researcher narrowing the indexed sources still benefits from external links.
  const selected = params.sources ? new Set(params.sources.split(",").map((s) => s.trim())) : null;
  const active = selected ? recordProviders.filter((a) => selected.has(a.id)) : recordProviders;

  return fanOut(query, env, { adapters: active, linkOutBuilders: linkOutProviders, timeoutMs: timeoutMs(env) });
}

/** Clamp to the range the Zod schema used to enforce; anything unusable falls back to 20. */
function boundedLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 20;
  return Math.min(100, Math.max(1, Math.trunc(value as number)));
}

/** A year is only useful to adapters as a whole number; anything else is dropped. */
function year(value: number | undefined): number | undefined {
  return Number.isFinite(value) ? Math.trunc(value as number) : undefined;
}
