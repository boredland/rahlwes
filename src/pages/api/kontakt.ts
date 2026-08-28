import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { currentLocale, type Locale } from '@i18n/config'

export const prerender = false

/** Mirrors the fields of the old Squarespace form. */
type ContactPayload = {
  fname: string
  lname: string
  email: string
  message: string
  consent: boolean
  locale: Locale
  /** Honeypot: a real person never fills this, bots fill everything. */
  website?: string
  'cf-turnstile-response'?: string
}

const RECIPIENT = 'info@rahlwes.eu'
const SENDER = 'kontakt@send.rahlwes.eu'

const LIMITS = { name: 100, email: 254, message: 5000 } as const

const replies = {
  de: {
    ok: 'Vielen Dank! Ihre Nachricht ist angekommen. Sie erhalten eine Bestätigung per E-Mail.',
    invalid: 'Bitte füllen Sie alle Pflichtfelder aus.',
    consent: 'Bitte stimmen Sie der Verarbeitung Ihrer Daten zu.',
    captcha: 'Die Spam-Prüfung ist fehlgeschlagen. Bitte laden Sie die Seite neu.',
    error: 'Die Nachricht konnte nicht gesendet werden. Bitte schreiben Sie mir direkt an info@rahlwes.eu.',
    rateLimited: 'Zu viele Anfragen in kurzer Zeit. Bitte versuchen Sie es in einer Minute erneut.',
  },
  en: {
    ok: 'Thank you! Your message has arrived. You will receive a confirmation by email.',
    invalid: 'Please fill in all required fields.',
    consent: 'Please consent to the processing of your data.',
    captcha: 'The spam check failed. Please reload the page.',
    error: 'The message could not be sent. Please email me directly at info@rahlwes.eu.',
    rateLimited: 'Too many requests in a short time. Please try again in a minute.',
  },
  fr: {
    ok: 'Merci ! Votre message est bien arrivé. Vous recevrez une confirmation par e-mail.',
    invalid: 'Veuillez remplir tous les champs obligatoires.',
    consent: 'Veuillez consentir au traitement de vos données.',
    captcha: 'La vérification anti-spam a échoué. Veuillez recharger la page.',
    error: 'Le message n’a pas pu être envoyé. Écrivez-moi directement à info@rahlwes.eu.',
    rateLimited: 'Trop de requêtes en peu de temps. Veuillez réessayer dans une minute.',
  },
} satisfies Record<Locale, Record<string, string>>

/** Confirmation sent to the sender, in the language they used. */
const confirmations = {
  de: {
    subject: 'Ihre Nachricht an Ann-Kathrin Rahlwes',
    greeting: (name: string) => `Hallo ${name},`,
    body: 'vielen Dank für Ihre Nachricht. Ich melde mich so bald wie möglich bei Ihnen.\n\nIhre Nachricht:',
    signature: 'Ann-Kathrin Rahlwes — Historikerin',
  },
  en: {
    subject: 'Your message to Ann-Kathrin Rahlwes',
    greeting: (name: string) => `Hello ${name},`,
    body: 'thank you for your message. I will get back to you as soon as possible.\n\nYour message:',
    signature: 'Ann-Kathrin Rahlwes — Historian',
  },
  fr: {
    subject: 'Votre message à Ann-Kathrin Rahlwes',
    greeting: (name: string) => `Bonjour ${name},`,
    body: 'merci pour votre message. Je vous répondrai dès que possible.\n\nVotre message :',
    signature: 'Ann-Kathrin Rahlwes — Historienne',
  },
} satisfies Record<Locale, unknown>

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}

async function verifyTurnstile(token: string | undefined, secret: string, ip: string | null) {
  if (!token) return false

  const body = new FormData()
  body.append('secret', secret)
  body.append('response', token)
  if (ip) body.append('remoteip', ip)

  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body,
  })
  const outcome = (await response.json()) as { success: boolean; 'error-codes'?: string[] }
  if (!outcome.success) console.warn('turnstile rejected', outcome['error-codes'])
  return outcome.success
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  let payload: ContactPayload

  try {
    payload = (await request.json()) as ContactPayload
  } catch {
    return Response.json({ ok: false, message: replies.de.invalid }, { status: 400 })
  }

  const locale = currentLocale(payload.locale)
  const t = replies[locale]

  // Silently accept honeypot hits: telling a bot it failed only helps it adapt.
  if (payload.website) return Response.json({ ok: true, message: t.ok })

  // Per-IP throttle. Runs before any outbound work so a flood costs us nothing.
  const { success } = await env.CONTACT_LIMIT.limit({ key: clientAddress ?? 'unknown' })
  if (!success) return Response.json({ ok: false, message: t.rateLimited }, { status: 429 })

  const fname = (payload.fname ?? '').trim().slice(0, LIMITS.name)
  const lname = (payload.lname ?? '').trim().slice(0, LIMITS.name)
  const email = (payload.email ?? '').trim().slice(0, LIMITS.email)
  const message = (payload.message ?? '').trim().slice(0, LIMITS.message)

  if (!fname || !lname || !message || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ ok: false, message: t.invalid }, { status: 400 })
  }
  if (!payload.consent) {
    return Response.json({ ok: false, message: t.consent }, { status: 400 })
  }

  // Optional so the form still works before the widget exists; once the secret is
  // set every submission must pass verification.
  const secret = (env as Env & { TURNSTILE_SECRET_KEY?: string }).TURNSTILE_SECRET_KEY
  if (secret) {
    const ok = await verifyTurnstile(payload['cf-turnstile-response'], secret, clientAddress ?? null)
    if (!ok) return Response.json({ ok: false, message: t.captcha }, { status: 403 })
  }

  const sender = `${fname} ${lname}`
  const received = new Date().toISOString()

  try {
    await env.EMAIL.send({
      to: RECIPIENT,
      from: { email: SENDER, name: 'Kontaktformular rahlwes.eu' },
      replyTo: email,
      subject: `Kontaktanfrage von ${sender}`,
      text: [
        `Name:      ${sender}`,
        `E-Mail:    ${email}`,
        `Sprache:   ${locale}`,
        `Empfangen: ${received}`,
        '',
        message,
      ].join('\n'),
      html: [
        '<h2>Kontaktanfrage über rahlwes.eu</h2>',
        '<table cellpadding="4">',
        `<tr><td><strong>Name</strong></td><td>${escapeHtml(sender)}</td></tr>`,
        `<tr><td><strong>E-Mail</strong></td><td><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></td></tr>`,
        `<tr><td><strong>Sprache</strong></td><td>${locale}</td></tr>`,
        `<tr><td><strong>Empfangen</strong></td><td>${received}</td></tr>`,
        '</table>',
        `<p style="white-space:pre-wrap">${escapeHtml(message)}</p>`,
      ].join(''),
    })
  } catch (error) {
    console.error('contact form send failed', error)
    return Response.json({ ok: false, message: t.error }, { status: 502 })
  }

  // The confirmation is a courtesy; a failure here must not tell the sender their
  // message was lost, because it was not.
  const confirmation = confirmations[locale]
  try {
    await env.EMAIL.send({
      to: email,
      from: { email: SENDER, name: 'Ann-Kathrin Rahlwes' },
      replyTo: RECIPIENT,
      subject: confirmation.subject,
      text: `${confirmation.greeting(fname)}\n\n${confirmation.body}\n\n${message}\n\n—\n${confirmation.signature}\n${RECIPIENT}`,
      html: [
        `<p>${escapeHtml(confirmation.greeting(fname))}</p>`,
        `<p>${escapeHtml(confirmation.body)}</p>`,
        `<blockquote style="white-space:pre-wrap;border-left:3px solid #f17018;padding-left:1em">${escapeHtml(message)}</blockquote>`,
        `<p>—<br>${escapeHtml(confirmation.signature)}<br><a href="mailto:${RECIPIENT}">${RECIPIENT}</a></p>`,
      ].join(''),
    })
  } catch (error) {
    console.error('contact confirmation failed', error)
  }

  return Response.json({ ok: true, message: t.ok })
}
