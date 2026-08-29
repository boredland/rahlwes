import type { Cfp } from './db'
import { cfpSourceName } from './db'
import { escapeHtml, NEWSLETTER_SENDER_NAME, SITE_ORIGIN } from '@newsletter/email'

/**
 * The digest is bulk mail to a list, so it goes out on the marketing domain with
 * the rest of it. Receivers score reputation per sending domain and this is the
 * one that already carries list traffic; putting it on `send.rahlwes.eu` would
 * mix it with the contact-form replies that must stay clean.
 */
export const CFP_SENDER = 'newsletter@marketing.rahlwes.eu'

/** Deliberately outside `/api/admin`: the recipient following it is not an admin. */
export function cfpUnsubscribeUrl(token: string): string {
  return `${SITE_ORIGIN}/api/cfps/unsubscribe?token=${token}`
}

/**
 * RFC 8058. Without these headers a recipient who wants out has only the spam
 * button, and a complaint costs the sending domain far more than an unsubscribe.
 */
export function cfpUnsubscribeHeaders(token: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${cfpUnsubscribeUrl(token)}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** Digest subject and body for the calls found in one scraper run. */
export function cfpDigestEmail(cfps: Cfp[], token: string) {
  const subject =
    cfps.length === 1
      ? '1 neue Ausschreibung'
      : `${cfps.length} neue Ausschreibungen`

  const html = [
    `<p>${escapeHtml(`${cfps.length === 1 ? 'Eine neue Ausschreibung' : `${cfps.length} neue Ausschreibungen`} seit der letzten Prüfung:`)}</p>`,
    '<ul style="padding-inline-start:1.2em">',
    ...cfps.map((cfp) => {
      const source = cfpSourceName[cfp.source] ?? cfp.source
      return [
        '<li style="margin-block-end:1em">',
        `<a href="${escapeHtml(cfp.url)}"><strong>${escapeHtml(cfp.title)}</strong></a><br>`,
        `<span style="font-size:.9em;color:#555">${escapeHtml(source)} · ${escapeHtml(formatDate(cfp.date))}</span>`,
        cfp.deadline
          ? `<br><strong style="font-size:.9em">Einsendeschluss ${escapeHtml(cfp.deadline)}</strong>`
          : '',
        cfp.description ? `<br>${escapeHtml(cfp.description)}` : '',
        '</li>',
      ].join('')
    }),
    '</ul>',
    '<hr style="margin-top:2em;border:none;border-top:1px solid #ddd">',
    '<p style="font-size:.85em;color:#555">Sie erhalten diese E-Mail, weil Ihre Adresse für den Ausschreibungs-Überblick eingetragen ist.<br>',
    `<a href="${cfpUnsubscribeUrl(token)}">Abmelden</a></p>`,
  ].join('')

  const text = [
    `${cfps.length === 1 ? 'Eine neue Ausschreibung' : `${cfps.length} neue Ausschreibungen`} seit der letzten Prüfung:`,
    '',
    ...cfps.map((cfp) => {
      const source = cfpSourceName[cfp.source] ?? cfp.source
      const deadline = cfp.deadline ? `\n  Einsendeschluss ${cfp.deadline}` : ''
      return `* ${cfp.title}\n  ${source} · ${formatDate(cfp.date)}${deadline}\n  ${cfp.url}${cfp.description ? `\n  ${cfp.description}` : ''}`
    }),
    '',
    '—',
    NEWSLETTER_SENDER_NAME,
    `Abmelden: ${cfpUnsubscribeUrl(token)}`,
  ].join('\n')

  return { subject, html, text }
}
