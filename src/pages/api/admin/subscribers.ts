import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { isLocale, defaultLocale } from '@i18n/config'
import { isEmail, normalizeEmail } from '@newsletter/db'
import { createToken } from '@newsletter/tokens'

export const prerender = false

/**
 * Bulk import. Imported addresses are stored verified: they opted in on the old
 * platform, and mailing a confirmation to a list that already said yes is the
 * bigger annoyance. `ON CONFLICT DO NOTHING` keeps a re-paste from resetting the
 * unsubscribe token of someone already on the list, which would break the
 * unsubscribe links in mail they have already received.
 */
export const POST: APIRoute = async ({ request }) => {
  let emails: string[]
  let locale = defaultLocale

  try {
    const body = (await request.json()) as { emails?: string; locale?: string }
    emails = String(body.emails ?? '')
      .split(/[\s,;]+/)
      .map(normalizeEmail)
      .filter(Boolean)
    if (isLocale(body.locale)) locale = body.locale
  } catch {
    return Response.json({ ok: false, message: 'Ungültige Anfrage.' }, { status: 400 })
  }

  const valid = [...new Set(emails.filter(isEmail))]
  const rejected = emails.length - valid.length

  if (!valid.length) {
    return Response.json({ ok: false, message: 'Keine gültigen Adressen gefunden.' }, { status: 400 })
  }

  // An imported address has no browser to ask, so it inherits the language chosen for
  // the import rather than the column default, which would claim German for everyone.
  const statement = env.NEWSLETTER_DB.prepare(
    'INSERT INTO subscribers (email, locale, browser_locale, verified, unsubscribe_token) VALUES (?, ?, ?, 1, ?) ON CONFLICT (email) DO NOTHING',
  )

  try {
    const results = await env.NEWSLETTER_DB.batch(
      valid.map((email) => statement.bind(email, locale, locale, createToken())),
    )
    const imported = results.reduce((total, result) => total + (result.meta.changes ?? 0), 0)

    return Response.json({
      ok: true,
      imported,
      skipped: valid.length - imported,
      rejected,
    })
  } catch (error) {
    console.error('subscriber import failed', error)
    return Response.json({ ok: false, message: 'Import fehlgeschlagen.' }, { status: 500 })
  }
}

/**
 * Clears a bounce flag so the address is mailed again.
 *
 * Cloudflare keeps its own account-wide suppression for hard bounces, so this only
 * helps where the underlying problem is fixed (a full mailbox emptied, a manual
 * suppression removed in the dashboard). If the address is still suppressed there,
 * the next send re-flags it.
 */
export const PATCH: APIRoute = async ({ request }) => {
  let id: number

  try {
    const body = (await request.json()) as { id?: number }
    id = Number(body.id)
  } catch {
    return Response.json({ ok: false, message: 'Ungültige Anfrage.' }, { status: 400 })
  }

  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ ok: false, message: 'Ungültige ID.' }, { status: 400 })
  }

  await env.NEWSLETTER_DB.prepare(
    'UPDATE subscribers SET bounced_at = NULL, bounce_reason = NULL WHERE id = ?',
  )
    .bind(id)
    .run()

  return Response.json({ ok: true })
}

export const DELETE: APIRoute = async ({ request }) => {
  let id: number

  try {
    const body = (await request.json()) as { id?: number }
    id = Number(body.id)
  } catch {
    return Response.json({ ok: false, message: 'Ungültige Anfrage.' }, { status: 400 })
  }

  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ ok: false, message: 'Ungültige ID.' }, { status: 400 })
  }

  await env.NEWSLETTER_DB.prepare('DELETE FROM subscribers WHERE id = ?').bind(id).run()
  return Response.json({ ok: true })
}
