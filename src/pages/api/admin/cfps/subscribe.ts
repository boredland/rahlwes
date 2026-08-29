import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { isEmail, normalizeEmail } from '@newsletter/db'
import { createToken } from '@newsletter/tokens'

export const prerender = false

/**
 * Adds an address to the CfP digest.
 *
 * Behind the admin middleware, so the only caller is an authenticated editor
 * adding an address deliberately — there is no public form and therefore no
 * double opt-in to run. `ON CONFLICT DO NOTHING` keeps a re-submit from rotating
 * the unsubscribe token behind links already sent out.
 */
export const POST: APIRoute = async ({ request }) => {
  let email: string

  try {
    const body = (await request.json()) as { email?: string }
    email = normalizeEmail(String(body.email ?? ''))
  } catch {
    return Response.json({ ok: false, message: 'Ungültige Anfrage.' }, { status: 400 })
  }

  if (!isEmail(email)) {
    return Response.json({ ok: false, message: 'Keine gültige E-Mail-Adresse.' }, { status: 400 })
  }

  try {
    const result = await env.NEWSLETTER_DB.prepare(
      'INSERT INTO cfp_subscribers (email, unsubscribe_token) VALUES (?, ?) ON CONFLICT (email) DO NOTHING',
    )
      .bind(email, createToken())
      .run()

    return Response.json({ ok: true, added: result.meta.changes ?? 0 })
  } catch (error) {
    console.error('cfp subscribe failed', error)
    return Response.json({ ok: false, message: 'Eintragen fehlgeschlagen.' }, { status: 500 })
  }
}

export const DELETE: APIRoute = async ({ request }) => {
  let email: string

  try {
    const body = (await request.json()) as { email?: string }
    email = normalizeEmail(String(body.email ?? ''))
  } catch {
    return Response.json({ ok: false, message: 'Ungültige Anfrage.' }, { status: 400 })
  }

  await env.NEWSLETTER_DB.prepare('DELETE FROM cfp_subscribers WHERE email = ?').bind(email).run()
  return Response.json({ ok: true })
}
