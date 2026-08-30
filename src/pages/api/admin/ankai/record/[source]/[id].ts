import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { recordProviders } from '@ankai/providers'
import type { AnkaiEnv, Ctx } from '@ankai/types'

export const prerender = false

/** Fetch one record from a source that supports direct lookup. */
export const GET: APIRoute = async ({ params }) => {
  const { source, id } = params
  if (!id) return Response.json({ ok: false, message: 'Keine ID angegeben.' }, { status: 400 })

  const adapter = recordProviders.find((a) => a.id === source)
  if (!adapter?.getRecord) {
    return Response.json({ ok: false, message: `Quelle '${source}' kennt keinen Einzelabruf.` }, { status: 404 })
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  const ctx: Ctx = { env: env as unknown as AnkaiEnv, signal: controller.signal }

  try {
    const record = await adapter.getRecord(id, ctx)
    return record ? Response.json(record) : Response.json({ ok: false, message: 'Nicht gefunden.' }, { status: 404 })
  } catch (error) {
    console.error('record lookup failed', error)
    return Response.json({ ok: false, message: 'Abruf fehlgeschlagen.' }, { status: 502 })
  } finally {
    clearTimeout(timer)
  }
}
