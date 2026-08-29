import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import type { Cfp, CfpSubscriber } from '@cfp/db'
import { cfpDigestEmail, cfpUnsubscribeHeaders, CFP_SENDER } from '@cfp/email'
import { NEWSLETTER_SENDER_NAME } from '@newsletter/email'

export const prerender = false

/**
 * Receives the calls a scraper run found and mails them to the digest list.
 *
 * Outside `/api/admin` because the caller is a GitHub Action, which has no
 * Keystatic cookie to present. It authenticates with `CFP_WEBHOOK_SECRET`
 * instead — a Worker secret, compared in constant time so a wrong guess reveals
 * nothing through timing.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export const POST: APIRoute = async ({ request }) => {
  // A Worker secret is absent from the generated Env type until it exists.
  const { CFP_WEBHOOK_SECRET: secret } = env as Env & { CFP_WEBHOOK_SECRET?: string }
  if (!secret) {
    console.error('CFP_WEBHOOK_SECRET is not set; refusing to accept a digest')
    return Response.json({ ok: false, message: 'Not configured.' }, { status: 503 })
  }

  const presented = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (!timingSafeEqual(presented, secret)) {
    return Response.json({ ok: false, message: 'Not authorised.' }, { status: 401 })
  }

  let cfps: Cfp[]
  try {
    const body = (await request.json()) as { cfps?: Cfp[] }
    cfps = Array.isArray(body.cfps) ? body.cfps : []
  } catch {
    return Response.json({ ok: false, message: 'Ungültige Anfrage.' }, { status: 400 })
  }

  // Nothing found is the normal outcome on most days, not a failure.
  if (!cfps.length) return Response.json({ ok: true, sent: 0, reason: 'no new calls' })

  const subscribers = await env.NEWSLETTER_DB.prepare('SELECT * FROM cfp_subscribers ORDER BY id')
    .all<CfpSubscriber>()
    .then((r) => r.results)

  if (!subscribers.length) return Response.json({ ok: true, sent: 0, reason: 'no subscribers' })

  let sent = 0
  const failed: string[] = []

  // The list is a handful of internal addresses, so it is mailed inline rather
  // than through the newsletter queue: no fan-out worth the extra moving parts.
  for (const subscriber of subscribers) {
    const digest = cfpDigestEmail(cfps, subscriber.unsubscribe_token)

    try {
      await env.NEWSLETTER_EMAIL.send({
        to: subscriber.email,
        from: { email: CFP_SENDER, name: NEWSLETTER_SENDER_NAME },
        subject: digest.subject,
        html: digest.html,
        text: digest.text,
        headers: cfpUnsubscribeHeaders(subscriber.unsubscribe_token),
      })
      sent++
    } catch (error) {
      // One bad address must not cost the rest of the list its digest.
      console.error('cfp digest send failed', subscriber.email, error)
      failed.push(subscriber.email)
    }
  }

  return Response.json({ ok: true, sent, failed: failed.length })
}
