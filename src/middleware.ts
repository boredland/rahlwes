import { defineMiddleware } from 'astro:middleware'

/**
 * Guards the newsletter admin with the Keystatic GitHub login, so there is no
 * second password to manage.
 *
 * The cookie alone proves nothing: it is readable by client JS by Keystatic's own
 * design, so possession of a token is not authorisation. Each request therefore
 * asks GitHub whether this token can still write to the content repository, which
 * is exactly the permission that lets someone edit the site anyway.
 *
 * The check costs one API call per admin request. That is acceptable for a handful
 * of page views by one person, and it means revoking GitHub access revokes this
 * access immediately.
 */
const REPO = 'boredland/rahlwes'

async function hasRepoAccess(token: string): Promise<boolean> {
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
    return repo.permissions?.push === true
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
