import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { isToken } from '@newsletter/tokens'

export const prerender = false

/**
 * Public on purpose: the recipient of a digest is not an admin, and a token they
 * cannot act on is not an unsubscribe link. The token is the whole credential —
 * 256 unguessable bits that authorise removing exactly one address.
 *
 * The link in the mail only shows a button, because mail scanners fetch every link
 * and a GET that deleted the row would drop recipients nobody asked to remove. The
 * RFC 8058 one-click POST, token in the query string, is answered in `src/worker.ts`
 * ahead of Astro's CSRF check; this handler takes the same-origin form post.
 */
function page(body: string, status = 200) {
  return new Response(
    `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Ausschreibungen abbestellen</title><body style="font-family:system-ui,sans-serif;max-width:34rem;margin:4rem auto;padding:0 1rem;line-height:1.5">${body}</body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  )
}

export const GET: APIRoute = ({ url }) => {
  const token = url.searchParams.get('token')
  if (!isToken(token)) return page('<p>Ungültiger Abmeldelink.</p>', 400)

  return page(
    `<p>Keine Ausschreibungs-E-Mails mehr an diese Adresse schicken?</p><form method="post"><input type="hidden" name="token" value="${token}"><button type="submit">Abmelden</button></form>`,
  )
}

export const POST: APIRoute = async ({ request }) => {
  const form = await request.formData().catch(() => null)
  const token = form?.get('token')
  if (typeof token !== 'string' || !isToken(token)) return page('<p>Ungültiger Abmeldelink.</p>', 400)

  await env.NEWSLETTER_DB.prepare('DELETE FROM cfp_subscribers WHERE unsubscribe_token = ?').bind(token).run()
  return page('<p>Sie erhalten keine Ausschreibungs-E-Mails mehr.</p>')
}
