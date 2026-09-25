import { defineMiddleware } from 'astro:middleware'

/**
 * Guards the admin with the Keystatic GitHub login, so there is no second password
 * to manage.
 *
 * The cookie alone proves nothing: it is readable by client JS by Keystatic's own
 * design, so possession of a token is not authorisation. GitHub is asked whether
 * this token can still write to the content repository, which is exactly the
 * permission that lets someone edit the site anyway.
 *
 * A yes is remembered for a minute in the isolate, so the archive search's paged
 * requests and an admin page's own API calls do not each wait on GitHub. A no is
 * never cached, and a minute bounds how long a revoked token keeps working. The
 * cache is keyed by a hash so the token itself is never held as a key.
 */
const REPO = 'boredland/rahlwes'
const GRANT_TTL_MS = 60_000
const grants = new Map<string, number>()

async function hasRepoAccess(token: string): Promise<boolean> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  const key = btoa(String.fromCharCode(...new Uint8Array(digest)))
  const now = Date.now()
  if ((grants.get(key) ?? 0) > now) return true

  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'rahlwes-newsletter-admin',
      },
    })
    if (!response.ok) return false

    const repo = (await response.json()) as { permissions?: { push?: boolean } }
    if (repo.permissions?.push !== true) return false

    grants.set(key, now + GRANT_TTL_MS)
    return true
  } catch (error) {
    console.error('admin auth check failed', error)
    return false
  }
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url
  const isAdmin = pathname.startsWith('/admin') || pathname.startsWith('/api/admin')
  if (!isAdmin) return next()

  // /api/cfps/* is deliberately not under /api/admin: the digest webhook is called
  // by a GitHub Action holding a shared secret rather than a login cookie, and the
  // unsubscribe link is followed by a recipient who was never an admin. Both carry
  // their own credential and are checked in their own handlers.

  const token = context.cookies.get('keystatic-gh-access-token')?.value
  if (token && (await hasRepoAccess(token))) return next()

  // An API caller cannot follow a login redirect usefully, so it gets a status.
  if (pathname.startsWith('/api/admin')) {
    return Response.json({ ok: false, message: 'Not authenticated.' }, { status: 401 })
  }

  return context.redirect(`/api/keystatic/github/login?from=${encodeURIComponent(pathname)}`, 302)
})
