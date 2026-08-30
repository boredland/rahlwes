import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { ingestGedenkbuchCsv } from '@ankai/lib/gedenkbuch'
import type { AnkaiEnv } from '@ankai/types'

export const prerender = false

/**
 * Load a Bundesarchiv Gedenkbuch CSV export into the archive corpus. Body is the raw CSV.
 *
 * Rewrites rows in ANKAI_DB, which is why it stays under /api/admin: the guard is the
 * only thing standing between a stray request and the searchable corpus.
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const csv = await request.text()
    if (!csv.trim()) return Response.json({ ok: false, message: 'Leerer Upload.' }, { status: 400 })

    const ingested = await ingestGedenkbuchCsv(env as unknown as AnkaiEnv, csv)
    return Response.json({ ok: true, ingested })
  } catch (error) {
    console.error('gedenkbuch ingest failed', error)
    return Response.json({ ok: false, message: 'Import fehlgeschlagen.' }, { status: 502 })
  }
}
