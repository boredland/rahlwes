import { normalizeEmail } from './db'

export type Suppression = {
  id: string
  email: string
  /** `hard_bounce`, `spam_complaint` or `manual`, per the Email Sending API. */
  reason: string
  created_at: string
}

type SuppressionPage = {
  result?: Suppression[]
  total?: number
  error?: string
}

/** The API caps a page at 1000; asking for the maximum keeps the round trips down. */
const PER_PAGE = 1000

/**
 * Reads the account-wide suppression list.
 *
 * This is the only feed for asynchronous bounces: `EMAIL.send()` resolves as soon
 * as the message is accepted, and a hard bounce lands hours later, at which point
 * Cloudflare suppresses the address. Without reconciling against this list, a dead
 * address stays on the list forever and quietly drags the bounce rate up.
 */
export async function fetchSuppressions(env: Env): Promise<Suppression[]> {
  // Worker secrets, set with `wrangler secret put`, so they are absent from the
  // generated Env type until they exist in the account.
  const { CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_API_TOKEN: token } = env as Env & {
    CLOUDFLARE_ACCOUNT_ID?: string
    CLOUDFLARE_API_TOKEN?: string
  }

  if (!accountId || !token) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required to read suppressions')
  }

  const suppressions: Suppression[] = []

  for (let page = 1; ; page++) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/suppression?page=${page}&per_page=${PER_PAGE}&order=created_at&direction=desc`
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${token}`, 'user-agent': 'rahlwes-newsletter' },
    })

    if (!response.ok) {
      throw new Error(`Suppression list request failed with ${response.status}`)
    }

    const body = (await response.json()) as SuppressionPage
    if (body.error) throw new Error(body.error)

    const batch = body.result ?? []
    suppressions.push(...batch)

    if (batch.length < PER_PAGE) return suppressions
  }
}

/**
 * Marks every subscriber whose address Cloudflare has suppressed.
 *
 * The suppression list covers the whole account, including the contact form, so
 * the match is made against our own rows rather than trusting it as a subscriber
 * list. Already-flagged rows are left alone so the original bounce timestamp
 * survives.
 */
export async function reconcileBounces(env: Env): Promise<{ checked: number; flagged: number }> {
  const suppressions = await fetchSuppressions(env)
  if (!suppressions.length) return { checked: 0, flagged: 0 }

  const statement = env.NEWSLETTER_DB.prepare(
    "UPDATE subscribers SET bounced_at = ?, bounce_reason = ? WHERE email = ? AND bounced_at IS NULL",
  )

  const results = await env.NEWSLETTER_DB.batch(
    suppressions.map((entry) =>
      statement.bind(entry.created_at, entry.reason, normalizeEmail(entry.email)),
    ),
  )

  return {
    checked: suppressions.length,
    flagged: results.reduce((total, result) => total + (result.meta.changes ?? 0), 0),
  }
}
