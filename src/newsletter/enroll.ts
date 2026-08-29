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
 * Starts a double opt-in, from the newsletter form or from the contact form's
 * opt-in box. Shared so both entry points obey the same rules: nobody is added to
 * the list without confirming, and an address that already confirmed is left alone.
 *
 * Callers apply their own rate limiting; this deliberately does none, because the
 * endpoints throttle the whole request rather than this step.
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
  const existing = await db.prepare('SELECT * FROM subscribers WHERE email = ?').bind(email).first<Subscriber>()

  // Already confirmed: stop here. Re-sending a confirmation would turn this into a
  // way to mail a third party repeatedly, and the address is on the list either way.
  if (existing?.verified) return 'already-subscribed'

  const verifyToken = createToken()

  if (existing) {
    await db
      .prepare('UPDATE subscribers SET verify_token = ?, locale = ?, browser_locale = ? WHERE id = ?')
      .bind(verifyToken, locale, browserLocale, existing.id)
      .run()
  } else {
    await db
      .prepare(
        'INSERT INTO subscribers (email, locale, browser_locale, verified, verify_token, unsubscribe_token) VALUES (?, ?, ?, 0, ?, ?)',
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
