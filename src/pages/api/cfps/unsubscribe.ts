import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { isToken } from '@newsletter/tokens'

export const prerender = false

/**
 * Public on purpose: the recipient of a digest is not an admin, and a token they
 * cannot act on is not an unsubscribe link. The token is the whole credential —
 * 256 unguessable bits that authorise removing exactly one address.
 *
 * GET so the link works from a mail client; the RFC 8058 one-click POST is
 * answered in `src/worker.ts`, ahead of Astro's CSRF check.
 */
export const GET: APIRoute = async ({ url }) => {
  const token = url.searchParams.get('token')
  if (!isToken(token)) {
    return new Response('Ungültiger Abmeldelink.', {
      status: 400,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  }

  await env.NEWSLETTER_DB.prepare('DELETE FROM cfp_subscribers WHERE unsubscribe_token = ?')
    .bind(token)
    .run()

  return new Response('Sie erhalten keine Ausschreibungs-E-Mails mehr.', {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}
