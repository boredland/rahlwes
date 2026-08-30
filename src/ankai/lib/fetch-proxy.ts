import type { AnkaiEnv } from "../types";

/**
 * Client for our fetch-proxy (github.com/boredland/fetch-proxy). Some upstreams block
 * Cloudflare datacenter IPs or need a real browser to run their JS flow; the proxy fetches
 * from a non-blocked IP and can render pages in headless Chromium (`render=1`). We reach for
 * it only when a direct fetch won't do.
 */
export interface ProxyOptions {
  /** Render in headless Chromium (runs the page's JS). Needed for stateful/JS search flows. */
  render?: boolean;
  /** With render, how long to let XHR content settle (ms). */
  waitMs?: number;
  /**
   * Cache the proxied response in KV for this many seconds, keyed by the resolved proxy URL.
   * The `render=1` flow costs ~10s per call, and edge (`cf.cacheTtl`) caching is unreliable
   * for this cross-zone, bearer-authenticated GET — so we cache the body in KV ourselves.
   */
  cacheTtl?: number;
  signal?: AbortSignal;
}

export function proxyConfigured(env: AnkaiEnv): boolean {
  return !!(env.FETCH_PROXY_URL && env.FETCH_PROXY_TOKEN);
}

/** Fetch a URL through the proxy and return the response body as text. Throws if unconfigured. */
export async function proxyFetchText(env: AnkaiEnv, targetUrl: string, opts: ProxyOptions = {}): Promise<string> {
  if (!env.FETCH_PROXY_URL || !env.FETCH_PROXY_TOKEN) throw new Error("fetch-proxy not configured");

  const proxy = new URL(env.FETCH_PROXY_URL);
  proxy.searchParams.set("url", targetUrl);
  if (opts.render) {
    proxy.searchParams.set("render", "1");
    proxy.searchParams.set("wait", String(opts.waitMs ?? 8000));
  }

  const cacheKey = opts.cacheTtl ? `proxy:${proxy.toString()}` : undefined;
  if (cacheKey) {
    const hit = await env.ANKAI_CACHE.get(cacheKey);
    if (hit !== null) return hit;
  }

  const res = await fetch(proxy.toString(), {
    headers: { authorization: `Bearer ${env.FETCH_PROXY_TOKEN}` },
    signal: opts.signal,
  });
  if (!res.ok) throw new Error(`fetch-proxy ${targetUrl} -> HTTP ${res.status}`);
  const body = await res.text();

  if (cacheKey && opts.cacheTtl) {
    await env.ANKAI_CACHE.put(cacheKey, body, { expirationTtl: opts.cacheTtl });
  }
  return body;
}

/** One step of a multi-step session (see the proxy's `?session=1` mode). */
export interface SessionStep {
  url: string;
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * Run a stateful multi-step flow through the proxy's session mode: the steps execute in one
 * browser context (shared cookie jar) on a non-blocked IP, and the LAST step's response is
 * returned — parsed as JSON. For backends where one request registers a query in a session
 * and another reads it back (Yad Vashem). Returns null if the proxy is unconfigured.
 */
export async function proxySession<T>(
  env: AnkaiEnv,
  labelUrl: string,
  steps: SessionStep[],
  signal?: AbortSignal,
): Promise<T | null> {
  if (!env.FETCH_PROXY_URL || !env.FETCH_PROXY_TOKEN) return null;
  const proxy = new URL(env.FETCH_PROXY_URL);
  proxy.searchParams.set("url", labelUrl);
  proxy.searchParams.set("session", "1");

  const res = await fetch(proxy.toString(), {
    method: "POST",
    headers: { authorization: `Bearer ${env.FETCH_PROXY_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(steps),
    signal,
  });
  if (!res.ok) throw new Error(`fetch-proxy session ${labelUrl} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}
