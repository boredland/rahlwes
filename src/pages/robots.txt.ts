import type { APIRoute } from 'astro'

/**
 * Staging and production need opposite robots policies, and this file duplicates
 * rahlwes.eu content — so it is generated from `site` rather than kept as a
 * static asset that would be wrong on one of the two domains.
 */
export const GET: APIRoute = ({ site }) => {
  const isProduction = site?.hostname === 'rahlwes.eu'

  const body = isProduction
    ? ['User-agent: *', 'Allow: /', '', `Sitemap: ${new URL('sitemap-index.xml', site).href}`, ''].join('\n')
    : ['# Staging mirror of rahlwes.eu — must never be indexed.', 'User-agent: *', 'Disallow: /', ''].join('\n')

  return new Response(body, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}
