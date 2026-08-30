import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'

export const prerender = false

/**
 * Same-origin proxy to the Ankai archive gateway at search.rahlwes.eu.
 *
 * The browser cannot call Ankai directly: it serves no CORS headers, and its
 * `ankai_auth` cookie is scoped to its own host, so a fetch from this origin would
 * be both blocked and unauthenticated. Proxying also keeps ANKAI_PASSWORD on the
 * server — the search UI never sees it.
 *
 * Living under /api/admin puts it behind the Keystatic guard in `src/middleware.ts`,
 * so reaching these records requires push access to the content repository. That is a
 * higher bar than Ankai's own shared password, which matters: these are persecution
 * records about named individuals.
 */

/** Only the read endpoints the search UI needs; ingest and record mutation stay out. */
const ALLOWED = { 'persons/search': true, sources: true } as Record<string, true>

const DEFAULT_ORIGIN = 'https://search.rahlwes.eu'

export const GET: APIRoute = async ({ params, request }) => {
  const path = params.path ?? ''

  // An allow-list rather than blanket forwarding: this endpoint is reachable by anyone
  // who can edit the site, and /admin/ingest/* on the other side rewrites the D1 corpus.
  if (!ALLOWED[path]) {
    return Response.json({ ok: false, message: 'Unbekannter Endpunkt.' }, { status: 404 })
  }

  // Worker secrets are absent from the generated Env type until they exist.
  // ANKAI_ORIGIN lets `npm run dev` point at a local Ankai instead of production.
  const { ANKAI_PASSWORD: password, ANKAI_ORIGIN: origin } = env as Env & {
    ANKAI_PASSWORD?: string
    ANKAI_ORIGIN?: string
  }
  if (!password) {
    console.error('ANKAI_PASSWORD is not configured')
    return Response.json({ ok: false, message: 'Archivsuche ist nicht konfiguriert.' }, { status: 503 })
  }

  const target = new URL(`/v1/${path}`, origin ?? DEFAULT_ORIGIN)
  target.search = new URL(request.url).search

  try {
    const response = await fetch(target, {
      headers: { authorization: `Bearer ${password}`, accept: 'application/json' },
      signal: AbortSignal.timeout(25_000),
    })

    // Ankai answers 401 when the password is wrong. Passing that through would make the
    // island bounce the user to a login they are already past, so it becomes a 502: the
    // upstream is misconfigured, the visitor is not unauthenticated.
    if (response.status === 401) {
      console.error('ankai rejected ANKAI_PASSWORD')
      return Response.json({ ok: false, message: 'Archivsuche lehnt die Anmeldung ab.' }, { status: 502 })
    }

    return new Response(response.body, {
      status: response.status,
      headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' },
    })
  } catch (error) {
    console.error('ankai proxy failed', error)
    const message = error instanceof Error && error.name === 'TimeoutError' ? 'Zeitüberschreitung.' : 'Archivsuche nicht erreichbar.'
    return Response.json({ ok: false, message }, { status: 504 })
  }
}
