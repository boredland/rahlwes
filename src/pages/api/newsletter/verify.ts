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
 * The link in the confirmation mail. It only shows a confirm button: corporate mail
 * scanners fetch every link in a message, so a GET that confirmed would sign up
 * whoever typed an address into the form, with nobody at that inbox ever agreeing.
 *
 * The page is picked by the stored row, so the button is in the subscriber's own
 * language rather than the language of the page they signed up on.
 */
export const GET: APIRoute = async ({ url, redirect }) => {
  const token = url.searchParams.get('token')
  if (!isToken(token)) return redirect(result(defaultLocale, 'invalid'), 302)

  const subscriber = await findByVerifyToken(env.NEWSLETTER_DB, token)
  if (!subscriber) return redirect(result(defaultLocale, 'invalid'), 302)

  return redirect(`${localizePath('/newsletter/', currentLocale(subscriber.locale))}?confirm=${token}`, 302)
}

/** The double opt-in itself. Clearing `verify_token` makes the link single-use. */
export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData().catch(() => null)
  const token = form?.get('token')
  if (typeof token !== 'string' || !isToken(token)) return redirect(result(defaultLocale, 'invalid'), 303)

  const subscriber = await env.NEWSLETTER_DB.prepare(
    'UPDATE subscribers SET verified = 1, verify_token = NULL WHERE verify_token = ? RETURNING locale',
  )
    .bind(token)
    .first<{ locale: string }>()

  if (!subscriber) return redirect(result(defaultLocale, 'invalid'), 303)
  return redirect(result(currentLocale(subscriber.locale), 'verified'), 303)
}
