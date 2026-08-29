import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { getEntry } from 'astro:content'
import { isLocale } from '@i18n/config'
import { listVerified } from '@newsletter/db'
import type { SendMessage } from '../../../../worker'

export const prerender = false

/** Queue accepts at most 100 messages per `sendBatch` call. */
const QUEUE_BATCH = 100

/**
 * Strips the rendered body down to something an email client will show.
 *
 * Mail clients drop <script> and <style> outright and render their contents as
 * text if they are left in, so they have to go rather than merely be ignored.
 */
function toEmailHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .trim()
}

/** A readable plain-text alternative; every mail needs one for clients and spam scoring. */
function toPlainText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export const POST: APIRoute = async ({ request }) => {
  let slug: string
  let locale: string

  try {
    const body = (await request.json()) as { slug?: string; locale?: string }
    slug = String(body.slug ?? '')
    locale = String(body.locale ?? '')
  } catch {
    return Response.json({ ok: false, message: 'Ungültige Anfrage.' }, { status: 400 })
  }

  if (!slug || !isLocale(locale)) {
    return Response.json({ ok: false, message: 'Newsletter nicht angegeben.' }, { status: 400 })
  }

  const entry = await getEntry('newsletters', `${locale}/${slug}`)
  if (!entry) return Response.json({ ok: false, message: 'Newsletter nicht gefunden.' }, { status: 404 })

  // Sending is irreversible, so the status has to be an explicit decision in the
  // editor rather than something a stray click here can override.
  if (entry.data.status !== 'ready') {
    return Response.json(
      { ok: false, message: 'Dieser Newsletter ist nicht als „Bereit zum Versand“ markiert.' },
      { status: 409 },
    )
  }

  const subscribers = await listVerified(env.NEWSLETTER_DB)
  if (!subscribers.length) {
    return Response.json({ ok: false, message: 'Keine bestätigten Abonnenten.' }, { status: 409 })
  }

  // Routed through the SELF binding: a plain fetch of the public hostname leaves the
  // Worker and comes back through the edge, which the runtime rejects with a 522.
  const preview = new URL(`/admin/preview?locale=${locale}&slug=${encodeURIComponent(slug)}`, request.url)
  const rendered = await env.SELF.fetch(preview, {
    headers: { cookie: request.headers.get('cookie') ?? '' },
  })
  if (!rendered.ok) {
    console.error('newsletter render failed', rendered.status)
    return Response.json({ ok: false, message: 'Der Inhalt konnte nicht gerendert werden.' }, { status: 502 })
  }

  const source = await rendered.text()
  const html = toEmailHtml(source)
  const text = toPlainText(source)

  if (!html) {
    return Response.json({ ok: false, message: 'Dieser Newsletter hat keinen Inhalt.' }, { status: 409 })
  }

  const campaign = await env.NEWSLETTER_DB.prepare(
    'INSERT INTO campaigns (slug, locale, subject, html, text) VALUES (?, ?, ?, ?, ?) RETURNING id',
  )
    .bind(slug, locale, entry.data.subject, html, text)
    .first<{ id: number }>()

  if (!campaign) {
    return Response.json({ ok: false, message: 'Kampagne konnte nicht angelegt werden.' }, { status: 500 })
  }

  // The claim rows are written before anything is queued: the consumer treats them
  // as the record of who still needs mailing, so a message must never arrive first.
  const claim = env.NEWSLETTER_DB.prepare(
    'INSERT INTO campaign_sends (campaign_id, subscriber_id) VALUES (?, ?)',
  )
  await env.NEWSLETTER_DB.batch(subscribers.map((s) => claim.bind(campaign.id, s.id)))

  const messages = subscribers.map((subscriber) => ({
    body: { campaignId: campaign.id, subscriberId: subscriber.id } satisfies SendMessage,
  }))

  for (let i = 0; i < messages.length; i += QUEUE_BATCH) {
    await env.NEWSLETTER_QUEUE.sendBatch(messages.slice(i, i + QUEUE_BATCH))
  }

  return Response.json({ ok: true, campaignId: campaign.id, queued: messages.length })
}
