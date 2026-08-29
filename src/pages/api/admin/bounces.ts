import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { reconcileBounces } from '@newsletter/suppressions'

export const prerender = false

/**
 * Runs the reconciliation the daily cron performs, for when someone wants the list
 * cleaned before a send rather than after it.
 */
export const POST: APIRoute = async () => {
  try {
    const { checked, flagged } = await reconcileBounces(env)
    return Response.json({ ok: true, checked, flagged })
  } catch (error) {
    console.error('bounce reconciliation failed', error)
    const message = error instanceof Error ? error.message : 'Abgleich fehlgeschlagen.'
    return Response.json({ ok: false, message }, { status: 502 })
  }
}
