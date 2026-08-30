import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { runSearch } from '@ankai/lib/search'
import type { AnkaiEnv } from '@ankai/types'

export const prerender = false

/**
 * Fan a person query out across the archive adapters.
 *
 * Under /api/admin so the Keystatic guard in `src/middleware.ts` covers it: reaching
 * records about named victims of persecution requires push access to the content
 * repository, rather than the shared password the standalone Ankai worker used.
 */
export const GET: APIRoute = async ({ url }) => {
  const q = url.searchParams

  try {
    const response = await runSearch(
      {
        name: q.get('name') ?? undefined,
        keywords: q.get('keywords') ?? undefined,
        birthYear: numeric(q.get('birthYear')),
        deathYear: numeric(q.get('deathYear')),
        limit: numeric(q.get('limit')),
        cursor: q.get('cursor') ?? undefined,
        sources: q.get('sources') ?? undefined,
        expandNames: q.get('expandNames') === 'true',
      },
      env as unknown as AnkaiEnv,
    )
    return Response.json(response)
  } catch (error) {
    // A single upstream failing is already absorbed by the fan-out, so reaching here
    // means the request itself could not be run at all.
    console.error('archive search failed', error)
    return Response.json({ ok: false, message: 'Die Suche ist fehlgeschlagen.' }, { status: 502 })
  }
}

/** Query strings are strings; anything unparseable is dropped rather than passed as NaN. */
function numeric(value: string | null): number | undefined {
  if (!value) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}
