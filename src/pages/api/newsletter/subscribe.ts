import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { currentLocale, type Locale } from '@i18n/config'
import { browserLocaleTag, matchLocale } from '@i18n/accept-language'
import { newsletterCopy } from '@newsletter/messages'
import { isEmail, normalizeEmail } from '@newsletter/db'
import { enrollSubscriber } from '@newsletter/enroll'

export const prerender = false

type SubscribePayload = {
  email: string
  consent: boolean
  locale: Locale
  /** Honeypot: a real person never fills this, bots fill everything. */
  website?: string
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  let payload: SubscribePayload

  try {
    payload = (await request.json()) as SubscribePayload
  } catch {
    return Response.json({ ok: false, message: newsletterCopy('de').signup.invalid }, { status: 400 })
  }

  // Which page they signed up on. Used for the reply they see right now, because a
  // German page must not answer in English just because the browser prefers it.
  const pageLocale = currentLocale(payload.locale)
  const t = newsletterCopy(pageLocale).signup

  // What to mail them, and the raw header behind that choice. A reader on the German
  // page whose browser asks for French gets French mail; someone whose browser asks
  // for a language the site does not publish falls back to the page they chose.
  const acceptLanguage = request.headers.get('accept-language')
  const locale = matchLocale(acceptLanguage) ?? pageLocale
  const browserLocale = browserLocaleTag(acceptLanguage)

  // Silently accept honeypot hits: telling a bot it failed only helps it adapt.
  if (payload.website) return Response.json({ ok: true, message: t.ok })

  const email = normalizeEmail(payload.email ?? '')
  if (!isEmail(email)) return Response.json({ ok: false, message: t.invalid }, { status: 400 })
  if (!payload.consent) return Response.json({ ok: false, message: t.consent }, { status: 400 })

  const { success } = await env.NEWSLETTER_LIMIT.limit({ key: clientAddress ?? 'unknown' })
  if (!success) return Response.json({ ok: false, message: t.rateLimited }, { status: 429 })

  try {
    // The reply is the same whether this started a confirmation or the address was
    // already on the list, so the response never reveals who is subscribed.
    await enrollSubscriber({ env, email, locale, browserLocale })
  } catch (error) {
    console.error('newsletter signup failed', error)
    return Response.json({ ok: false, message: t.error }, { status: 502 })
  }

  return Response.json({ ok: true, message: t.ok })
}
