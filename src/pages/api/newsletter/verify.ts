import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { defaultLocale, localizePath, currentLocale, type Locale } from '@i18n/config'
import { findByVerifyToken } from '@newsletter/db'
import { isToken } from '@newsletter/tokens'

export const prerender = false

function result(locale: Locale, status: 'verified' | 'invalid') {
  return `${localizePath('/newsletter/', locale)}?status=${status}`
}

/**
 * The double opt-in landing point. Clearing `verify_token` makes the link
 * single-use; the outcome is reported in the subscriber's own language, which is
 * why the locale comes from the stored row rather than the request.
 */
export const GET: APIRoute = async ({ url, redirect }) => {
  const token = url.searchParams.get('token')
  if (!isToken(token)) return redirect(result(defaultLocale, 'invalid'), 302)

  const subscriber = await findByVerifyToken(env.NEWSLETTER_DB, token)
  if (!subscriber) return redirect(result(defaultLocale, 'invalid'), 302)

  const locale = currentLocale(subscriber.locale)
  await env.NEWSLETTER_DB.prepare('UPDATE subscribers SET verified = 1, verify_token = NULL WHERE id = ?')
    .bind(subscriber.id)
    .run()

  return redirect(result(locale, 'verified'), 302)
}
