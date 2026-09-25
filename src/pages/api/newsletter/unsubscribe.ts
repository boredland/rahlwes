import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { currentLocale, localizePath } from '@i18n/config'
import { findByUnsubscribeToken, isEmail, normalizeEmail } from '@newsletter/db'
import { isToken } from '@newsletter/tokens'

export const prerender = false

type Submission = { email: string; token: string; locale: string }

async function readSubmission(request: Request): Promise<Submission> {
  const contentType = request.headers.get('content-type') ?? ''
  try {
    if (contentType.includes('json')) {
      const body = (await request.json()) as { email?: string; token?: string; locale?: string }
      return { email: body.email ?? '', token: body.token ?? '', locale: body.locale ?? '' }
    }
    const form = await request.formData()
    return {
      email: String(form.get('email') ?? ''),
      token: String(form.get('token') ?? ''),
      locale: String(form.get('locale') ?? ''),
    }
  } catch {
    return { email: '', token: '', locale: '' }
  }
}

/**
 * The form post behind /newsletter/abmelden/: the one-button form a mail link opens,
 * carrying the token, or the address form for readers who no longer have such a mail.
 *
 * The RFC 8058 one-click case never reaches this handler: it is answered in
 * src/worker.ts, ahead of Astro's CSRF check, which rejects the cross-origin POST a
 * mail client sends.
 *
 * An unknown address still reports success, because distinct responses would confirm
 * which addresses are on the list.
 */
export const POST: APIRoute = async ({ request }) => {
  const db = env.NEWSLETTER_DB
  const submission = await readSubmission(request)
  const email = normalizeEmail(submission.email)
  if (isToken(submission.token)) {
    await db.prepare('DELETE FROM subscribers WHERE unsubscribe_token = ?').bind(submission.token).run()
  } else if (isEmail(email)) {
    await db.prepare('DELETE FROM subscribers WHERE email = ?').bind(email).run()
  }

  const locale = currentLocale(submission.locale)
  const page = `${localizePath('/newsletter/abmelden/', locale)}?status=done`

  // A browser form post gets the readable page back; anything else gets the plain
  // acknowledgement, since 303 to HTML is meaningless to an API caller.
  const wantsHtml = request.headers.get('accept')?.includes('text/html')
  return wantsHtml ? new Response(null, { status: 303, headers: { location: page } }) : new Response('Unsubscribed', { status: 200 })
}

/** Some clients probe the URI with GET first; send those to the reader's own page. */
export const GET: APIRoute = async ({ url, redirect }) => {
  const token = url.searchParams.get('token')
  if (!isToken(token)) return redirect('/newsletter/abmelden/', 302)

  const subscriber = await findByUnsubscribeToken(env.NEWSLETTER_DB, token)
  const page = localizePath('/newsletter/abmelden/', currentLocale(subscriber?.locale))
  return redirect(`${page}?token=${token}`, 302)
}
