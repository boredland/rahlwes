/** Identify ourselves politely to every upstream. */
export const USER_AGENT =
  "ankai/0.1 (internal NS-victim research gateway; +https://next.rahlwes.eu)";

/**
 * Default edge-cache lifetime (seconds) for idempotent upstream GETs. Archive metadata
 * changes rarely and identical queries repeat often, so caching cuts latency and load on
 * slow/rate-limited upstreams. Only ever applied to GETs — never to stateful/session POSTs.
 */
export const UPSTREAM_CACHE_TTL = 3600;

/** Cloudflare cache directive for a subrequest, or {} to leave it uncached. */
function cacheInit(cacheTtl: number | undefined): RequestInit {
  return cacheTtl ? { cf: { cacheTtl, cacheEverything: true } } : {};
}

/**
 * The query string is where credentials travel for upstreams that take their key as a
 * parameter, and these messages reach the browser through the gateway's per-source
 * status. The host and path are enough to tell which source failed.
 */
function withoutQuery(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.split("?")[0]!;
  }
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
  cacheTtl?: number,
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    ...cacheInit(cacheTtl),
    signal,
    headers: { "user-agent": USER_AGENT, accept: "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${withoutQuery(url)} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function fetchText(
  url: string,
  signal: AbortSignal,
  headers?: HeadersInit,
  cacheTtl?: number,
): Promise<string> {
  const res = await fetch(url, {
    ...cacheInit(cacheTtl),
    signal,
    headers: { "user-agent": USER_AGENT, ...headers },
  });
  if (!res.ok) throw new Error(`${withoutQuery(url)} -> HTTP ${res.status}`);
  return res.text();
}
