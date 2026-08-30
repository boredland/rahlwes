import { vi } from "vitest";

export interface MockRoute {
  /** Substring matched against the request URL. First match wins. */
  match: string;
  status?: number;
  /** Response body — object is JSON-encoded, string is returned verbatim. */
  body: unknown;
  headers?: Record<string, string>;
}

export interface RecordedCall {
  url: string;
  method: string;
  body: string | null;
  headers: Record<string, string>;
  /** Cloudflare cache directive passed on the request, if any. */
  cf?: { cacheTtl?: number; cacheEverything?: boolean };
}

export interface MockFetch {
  calls: RecordedCall[];
  restore(): void;
}

/**
 * Install a `globalThis.fetch` stub that answers by URL-substring routing and records every
 * call. Adapters are exercised offline against these canned upstream shapes, so a change in
 * our mapping code is caught deterministically (drift in the *real* upstreams is caught
 * separately by the live tests). Unmatched URLs throw, so tests can't silently pass on a
 * request we didn't intend to make.
 */
export function installMockFetch(routes: MockRoute[]): MockFetch {
  const calls: RecordedCall[] = [];
  const original = globalThis.fetch;

  const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : null;
    const headers = new Headers(init?.headers);
    const cf = (init as { cf?: RecordedCall["cf"] } | undefined)?.cf;
    calls.push({ url, method, body, headers: Object.fromEntries(headers), cf });

    const route = routes.find((r) => url.includes(r.match));
    if (!route) throw new Error(`mock-fetch: no route for ${method} ${url}`);

    const payload = typeof route.body === "string" ? route.body : JSON.stringify(route.body);
    return new Response(payload, {
      status: route.status ?? 200,
      headers: route.headers ?? { "content-type": "application/json" },
    });
  });

  globalThis.fetch = stub as unknown as typeof fetch;
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

/** A never-aborting signal for offline tests that don't exercise timeout behaviour. */
export const noSignal = new AbortController().signal;

/** Minimal in-memory KVNamespace stub for tests that exercise KV-backed caching. */
export function memoryKv(): KVNamespace & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    get: (async (key: string) => store.get(key) ?? null) as KVNamespace["get"],
    put: (async (key: string, value: string) => {
      store.set(key, value);
    }) as KVNamespace["put"],
    delete: (async (key: string) => {
      store.delete(key);
    }) as KVNamespace["delete"],
  } as KVNamespace & { store: Map<string, string> };
}
