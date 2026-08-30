import astro from '@astrojs/cloudflare/entrypoints/server'
import type { Campaign, Subscriber } from './newsletter/db'
import {
  listUnsubscribeHeaders,
  withUnsubscribeFooter,
  NEWSLETTER_SENDER,
  NEWSLETTER_SENDER_NAME,
} from './newsletter/email'
import { currentLocale } from './i18n/config'
import { isToken } from './newsletter/tokens'
import { reconcileBounces } from './newsletter/suppressions'

/** What `/api/admin/newsletter/dispatch` puts on the queue, one message per recipient. */
export type SendMessage = {
  campaignId: number
  subscriberId: number
}

/**
 * Validation failures never succeed on a retry, so a redelivery only burns quota
 * and delays the rest of the batch. Transient codes are the ones worth retrying.
 * See the Email Sending error table.
 */
/**
 * The address itself is the problem, so the subscriber is marked bounced and never
 * mailed again. Cloudflare suppresses hard-bounced addresses account-wide and
 * rejects further sends to them with E_RECIPIENT_SUPPRESSED.
 */
const BOUNCE_ERRORS: Record<string, true> = {
  E_RECIPIENT_SUPPRESSED: true,
  E_RECIPIENT_NOT_ALLOWED: true,
}

const PERMANENT_ERRORS: Record<string, true> = {
  E_VALIDATION_ERROR: true,
  E_FIELD_MISSING: true,
  E_SENDER_NOT_VERIFIED: true,
  E_RECIPIENT_NOT_ALLOWED: true,
  E_RECIPIENT_SUPPRESSED: true,
  E_SENDER_DOMAIN_NOT_AVAILABLE: true,
  E_CONTENT_TOO_LARGE: true,
  E_HEADER_NOT_ALLOWED: true,
  E_HEADER_USE_API_FIELD: true,
  E_HEADER_VALUE_INVALID: true,
  E_HEADER_VALUE_TOO_LONG: true,
  E_HEADER_NAME_INVALID: true,
  E_HEADERS_TOO_LARGE: true,
  E_HEADERS_TOO_MANY: true,
}

async function deliver(message: SendMessage, env: Env, cachedCampaign?: Campaign): Promise<void> {
  const db = env.NEWSLETTER_DB

  // Claim the row first. Queues redeliver on failure and may deliver twice on
  // success, so this UPDATE is what stops a subscriber being mailed twice: it only
  // matches while the send is still pending.
  const claim = await db
    .prepare("UPDATE campaign_sends SET status = 'sending', updated_at = datetime('now') WHERE campaign_id = ? AND subscriber_id = ? AND status IN ('pending', 'failed')")
    .bind(message.campaignId, message.subscriberId)
    .run()

  if (!claim.meta.changes) return

  const [campaign, subscriber] = await Promise.all([
    cachedCampaign ?? db.prepare('SELECT * FROM campaigns WHERE id = ?').bind(message.campaignId).first<Campaign>(),
    db.prepare('SELECT * FROM subscribers WHERE id = ?').bind(message.subscriberId).first<Subscriber>(),
  ])

  // An unsubscribe between dispatch and delivery removes the row; that is a
  // successful outcome, not a failure to retry.
  if (!campaign || !subscriber) {
    await db
      .prepare("UPDATE campaign_sends SET status = 'skipped', updated_at = datetime('now') WHERE campaign_id = ? AND subscriber_id = ?")
      .bind(message.campaignId, message.subscriberId)
      .run()
    return
  }

  const locale = currentLocale(subscriber.locale)
  const body = withUnsubscribeFooter(
    { html: campaign.html, text: campaign.text },
    locale,
    subscriber.unsubscribe_token,
  )

  try {
    await env.NEWSLETTER_EMAIL.send({
      to: subscriber.email,
      from: { email: NEWSLETTER_SENDER, name: NEWSLETTER_SENDER_NAME },
      subject: campaign.subject,
      html: body.html,
      text: body.text,
      headers: listUnsubscribeHeaders(subscriber.unsubscribe_token),
    })
  } catch (error) {
    const code = (error as { code?: string }).code ?? ''
    const permanent = PERMANENT_ERRORS[code] === true

    await db
      .prepare("UPDATE campaign_sends SET status = ?, error = ?, updated_at = datetime('now') WHERE campaign_id = ? AND subscriber_id = ?")
      .bind(permanent ? 'permanent-failure' : 'failed', `${code} ${(error as Error).message ?? ''}`.trim(), message.campaignId, message.subscriberId)
      .run()

    // A rejected address stays rejected, so record it here rather than waiting for
    // the next suppression-list reconciliation to notice.
    if (BOUNCE_ERRORS[code] === true) {
      await db
        .prepare("UPDATE subscribers SET bounced_at = datetime('now'), bounce_reason = ? WHERE id = ? AND bounced_at IS NULL")
        .bind(code, subscriber.id)
        .run()
    }

    if (permanent) {
      console.error('newsletter send rejected', subscriber.email, code)
      return
    }
    throw error
  }

  await db
    .prepare("UPDATE campaign_sends SET status = 'sent', error = NULL, updated_at = datetime('now') WHERE campaign_id = ? AND subscriber_id = ?")
    .bind(message.campaignId, message.subscriberId)
    .run()
}

/**
 * RFC 8058 requires the unsubscribe POST to be honoured without confirmation, and mail
 * clients send it cross-origin with no Origin the framework will accept. Astro's CSRF
 * check rejects exactly that shape, so the one-click case is served here, ahead of it.
 *
 * Only a valid token does anything, and the token is unguessable, so there is nothing
 * for a forged request to accomplish beyond what its holder could already do.
 */
async function handleOneClickUnsubscribe(request: Request, env: Env): Promise<Response | null> {
  if (request.method !== 'POST') return null

  const url = new URL(request.url)
  if (url.pathname !== '/api/newsletter/unsubscribe') return null

  const token = url.searchParams.get('token')
  if (!isToken(token)) return null

  await env.NEWSLETTER_DB.prepare('DELETE FROM subscribers WHERE unsubscribe_token = ?').bind(token).run()
  return new Response('Unsubscribed', { status: 200 })
}

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
    const unsubscribed = await handleOneClickUnsubscribe(request, env)
    return unsubscribed ?? astro.fetch(request, env, context)
  },

  /**
   * Daily bounce reconciliation. Hard bounces surface on the account suppression
   * list hours after the send, so this is what keeps dead addresses out of the
   * next dispatch; there is no webhook to subscribe to.
   */
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    try {
      const { checked, flagged } = await reconcileBounces(env)
      console.log('bounce reconciliation', { checked, flagged })
    } catch (error) {
      console.error('bounce reconciliation failed', error)
    }
  },

  async queue(batch: MessageBatch<SendMessage>, env: Env): Promise<void> {
    // A batch is one campaign's recipients, and the campaign row carries the whole
    // rendered body. Reading it once per batch instead of once per subscriber saves
    // (batch size - 1) reads of the largest row in the database on every batch.
    const campaigns = new Map<number, Campaign | null>()

    for (const message of batch.messages) {
      try {
        const id = message.body.campaignId
        if (!campaigns.has(id)) {
          campaigns.set(
            id,
            await env.NEWSLETTER_DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(id).first<Campaign>(),
          )
        }

        // A missing campaign still goes through deliver(), which marks the send skipped.
        await deliver(message.body, env, campaigns.get(id) ?? undefined)
        message.ack()
      } catch (error) {
        console.error('newsletter delivery failed, retrying', message.body, error)
        message.retry()
      }
    }
  },
} satisfies ExportedHandler<Env, SendMessage>
