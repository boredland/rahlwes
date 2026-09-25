import type { Locale } from '@i18n/config'
import { isEmail, normalizeEmail, type Subscriber } from './db'
import { createToken } from './tokens'
import { confirmationEmail, NEWSLETTER_SENDER, NEWSLETTER_SENDER_NAME } from './email'

export type EnrollResult = 'confirmation-sent' | 'already-subscribed' | 'invalid'

type EnrollInput = {
  env: Env
  email: string
  /** The language to mail them in. */
  locale: Locale
  /** Raw `Accept-Language` tag, stored as the signal behind that choice. */
  browserLocale: string
}

/**
 * How long an unconfirmed address is left alone after a confirmation went out. The
 * signup throttle is per IP, so without this a rotating sender could mail one
 * stranger's inbox on every request.
 */
const CONFIRMATION_COOLDOWN = '-1 hour'

/**
 * Starts a double opt-in, from the newsletter form or from the contact form's
 * opt-in box. Shared so both entry points obey the same rules: nobody is added to
 * the list without confirming, an address that already confirmed is left alone,
 * and a pending one gets at most one confirmation per cooldown.
 *
 * Callers apply their own rate limiting on top; this only throttles per address.
 */
export async function enrollSubscriber({
  env,
  email: rawEmail,
  locale,
  browserLocale,
}: EnrollInput): Promise<EnrollResult> {
  const email = normalizeEmail(rawEmail)
  if (!isEmail(email)) return 'invalid'

  const db = env.NEWSLETTER_DB
  const existing = await db
    .prepare(
      "SELECT *, confirmation_sent_at > datetime('now', ?) AS cooling FROM subscribers WHERE email = ?",
    )
    .bind(CONFIRMATION_COOLDOWN, email)
    .first<Subscriber & { cooling: number | null }>()

  // Already confirmed: stop here. Re-sending a confirmation would turn this into a
  // way to mail a third party repeatedly, and the address is on the list either way.
  if (existing?.verified) return 'already-subscribed'

  // The earlier link is still valid, so a real reader who submitted twice loses
  // nothing, and the reply is the same so the throttle reveals nothing either.
  if (existing?.cooling) return 'confirmation-sent'

  const verifyToken = createToken()

  if (existing) {
    await db
      .prepare(
        "UPDATE subscribers SET verify_token = ?, locale = ?, browser_locale = ?, confirmation_sent_at = datetime('now') WHERE id = ?",
      )
      .bind(verifyToken, locale, browserLocale, existing.id)
      .run()
  } else {
    await db
      .prepare(
        "INSERT INTO subscribers (email, locale, browser_locale, verified, verify_token, unsubscribe_token, confirmation_sent_at) VALUES (?, ?, ?, 0, ?, ?, datetime('now'))",
      )
      .bind(email, locale, browserLocale, verifyToken, createToken())
      .run()
  }

  const message = confirmationEmail(locale, verifyToken)
  await env.NEWSLETTER_EMAIL.send({
    to: email,
    from: { email: NEWSLETTER_SENDER, name: NEWSLETTER_SENDER_NAME },
    subject: message.subject,
    text: message.text,
    html: message.html,
  })

  return 'confirmation-sent'
}
