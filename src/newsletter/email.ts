import type { Locale } from '@i18n/config'
import { newsletterCopy } from './messages'

/**
 * Bulk mail sends from its own subdomain, separate from the transactional
 * `send.rahlwes.eu` the contact form uses. Receivers score reputation per sending
 * domain, so a newsletter that collects spam complaints must not be able to drag
 * contact-form replies down with it.
 */
export const NEWSLETTER_SENDER = 'newsletter@marketing.rahlwes.eu'
export const NEWSLETTER_SENDER_NAME = 'Ann-Kathrin Rahlwes'
export const SITE_ORIGIN = 'https://next.rahlwes.eu'

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}

export function verifyUrl(token: string): string {
  return `${SITE_ORIGIN}/api/newsletter/verify?token=${token}`
}

/** The human-facing page; the one-click POST endpoint lives at /api/newsletter/unsubscribe. */
export function unsubscribeUrl(token: string): string {
  return `${SITE_ORIGIN}/newsletter/abmelden/?token=${token}`
}

/**
 * RFC 8058. Mail clients show a native unsubscribe control when both headers are
 * present and POST to the URI, which keeps complaints from turning into spam
 * reports. The target must act on POST without further confirmation.
 */
export function listUnsubscribeHeaders(token: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${SITE_ORIGIN}/api/newsletter/unsubscribe?token=${token}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
}

const BUTTON_STYLE =
  'display:inline-block;padding:.75em 1.5em;background:#f17018;color:#fff;text-decoration:none;border-radius:4px'

export function confirmationEmail(locale: Locale, token: string) {
  const copy = newsletterCopy(locale)
  const url = verifyUrl(token)

  return {
    subject: copy.confirmSubject,
    text: `${copy.confirmIntro}\n\n${url}\n\n${copy.confirmIgnore}\n\n—\n${NEWSLETTER_SENDER_NAME}`,
    html: [
      `<p>${escapeHtml(copy.confirmIntro)}</p>`,
      `<p><a href="${url}" style="${BUTTON_STYLE}">${escapeHtml(copy.confirmButton)}</a></p>`,
      `<p style="font-size:.9em;color:#555">${escapeHtml(copy.confirmIgnore)}</p>`,
      `<p>—<br>${escapeHtml(NEWSLETTER_SENDER_NAME)}</p>`,
    ].join(''),
  }
}

/** Appends the footer every bulk mail needs: why it arrived, and how to stop it. */
export function withUnsubscribeFooter(
  body: { html: string; text: string },
  locale: Locale,
  token: string,
) {
  const copy = newsletterCopy(locale)
  const url = unsubscribeUrl(token)

  return {
    html: [
      body.html,
      '<hr style="margin-top:2em;border:none;border-top:1px solid #ddd">',
      `<p style="font-size:.85em;color:#555">${escapeHtml(copy.unsubscribeNote)}<br>`,
      `<a href="${url}">${escapeHtml(copy.unsubscribeLabel)}</a></p>`,
    ].join(''),
    text: `${body.text}\n\n—\n${copy.unsubscribeNote}\n${copy.unsubscribeLabel}: ${url}`,
  }
}
