import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { currentLocale, localizePath } from '@i18n/config'
import { isEmail, normalizeEmail } from '@newsletter/db'
import { isToken } from '@newsletter/tokens'

export const prerender = false

type Submission = { email: string; locale: string }

async function readSubmission(request: Request): Promise<Submission> {
  const contentType = request.headers.get('content-type') ?? ''
  try {
    if (contentType.includes('json')) {
      const body = (await request.json()) as { email?: string; locale?: string }
      return { email: body.email ?? '', locale: body.locale ?? '' }
    }
    const form = await request.formData()
    return { email: String(form.get('email') ?? ''), locale: String(form.get('locale') ?? '') }
  } catch {
    return { email: '', locale: '' }
  }
}

/**
 * The form post behind /newsletter/abmelden/, for readers who no longer have a mail
 * carrying their token.
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
  if (isEmail(email)) {
    await db.prepare('DELETE FROM subscribers WHERE email = ?').bind(email).run()
  }

  const locale = currentLocale(submission.locale)
  const page = `${localizePath('/newsletter/abmelden/', locale)}?status=done`

  // A browser form post gets the readable page back; anything else gets the plain
  // acknowledgement, since 303 to HTML is meaningless to an API caller.
  const wantsHtml = request.headers.get('accept')?.includes('text/html')
  return wantsHtml ? new Response(null, { status: 303, headers: { location: page } }) : new Response('Unsubscribed', { status: 200 })
}

/** Some clients probe the URI with GET first; send those to the readable page. */
export const GET: APIRoute = ({ url, redirect }) => {
  const token = url.searchParams.get('token')
  return redirect(isToken(token) ? `/newsletter/abmelden/?token=${token}` : '/newsletter/abmelden/', 302)
}
