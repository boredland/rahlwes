/**
 * Checks a RUNNING origin against what a launch needs: indexing switches, canonical
 * hosts, the sitemap, the legacy Squarespace redirects, and the mail-link constant.
 *
 * It exists because the build cannot prove any of this. DNS, redirects and the hostname
 * baked into newsletter links only show up on a live origin, and the failures are silent:
 * a forgotten SITE_ORIGIN mails every subscriber a link to the staging host.
 *
 *   node scripts/verify-origin.mjs https://next.rahlwes.eu staging
 *   node scripts/verify-origin.mjs https://rahlwes.eu production
 *
 * Exit 0 when every check passes, 1 otherwise. Checks are independent: a failure in one
 * never stops the others. Nothing here sends mail.
 */
import { readFileSync } from 'node:fs'

const [originArg, modeArg] = process.argv.slice(2)
if (!originArg || !['staging', 'production'].includes(modeArg)) {
  console.error('usage: node scripts/verify-origin.mjs <origin> <staging|production>')
  process.exit(2)
}

const origin = originArg.replace(/\/+$/, '')
const host = new URL(origin).host
const production = modeArg === 'production'

/** The Squarespace sitemap as it stood on 2026-11-17, plus the sitemap itself. */
const LEGACY_PATHS = [
  '/journal',
  '/journal/google-arts-and-culture',
  '/journal/schwieriges-erbe',
  '/journal/gab-es-zwangsarbeit-whrend-des-nationalsozialismus-in-frankfurt',
  '/journal/digitale-spiele',
  '/journal/orteerforschen',
  '/journal/familienerforschen',
  '/journal-en',
  '/journal-en/the-frankfurt-history-app',
  '/leistungen',
  '/uebermich',
  '/newsletter',
  '/ausstellung-forschung',
  '/nachgefragt',
  '/familie-frank',
  '/provenienzforschung',
  '/digitales-storytelling',
  '/unterrichtsmaterial',
  '/nal',
  '/museen',
  '/sitemap.xml',
]

const PROJECT_PAGES = ['/projekte/nachgefragt/', '/projekte/geerbt-gekauft-geraubt/', '/projekte/notaufnahmelager-giessen/']

const get = (path, init) => fetch(origin + path, { headers: { 'user-agent': 'verify-origin' }, ...init })
const hostOf = (url) => new URL(url, origin).host

const results = []

async function check(name, run) {
  try {
    const problems = await run()
    results.push({ name, ok: problems.length === 0, detail: problems.join('; ') })
  } catch (error) {
    results.push({ name, ok: false, detail: `threw: ${error instanceof Error ? error.message : error}` })
  }
}

await check('1 robots.txt', async () => {
  const body = await (await get('/robots.txt')).text()
  if (!production) {
    const problems = []
    if (!/^Disallow: \/\s*$/m.test(body)) problems.push('staging robots.txt lacks "Disallow: /"')
    if (/^Allow: \//m.test(body)) problems.push('staging robots.txt contains "Allow: /"')
    return problems
  }
  const problems = []
  if (!/^Allow: \//m.test(body)) problems.push('production robots.txt lacks "Allow: /"')
  const sitemap = body.match(/^Sitemap:\s*(\S+)/m)
  if (!sitemap) problems.push('production robots.txt has no Sitemap line')
  else if (hostOf(sitemap[1]) !== host) problems.push(`Sitemap host is ${hostOf(sitemap[1])}, expected ${host}`)
  return problems
})

const homeHtml = await get('/').then((r) => r.text()).catch(() => '')

await check('2 noindex meta on the home page', async () => {
  const noindex = /<meta name="robots" content="noindex/i.test(homeHtml)
  if (production && noindex) return ['production home page carries noindex']
  if (!production && !noindex) return ['staging home page lacks noindex']
  return []
})

await check('3 canonical and hreflang host', async () => {
  const problems = []
  const canonical = homeHtml.match(/<link rel="canonical" href="([^"]+)"/)
  if (!canonical) problems.push('no canonical link')
  else if (hostOf(canonical[1]) !== host) problems.push(`canonical host is ${hostOf(canonical[1])}`)
  const alternates = [...homeHtml.matchAll(/<link rel="alternate"[^>]*hreflang="[^"]*"[^>]*href="([^"]+)"/g)]
  if (alternates.length < 3) problems.push(`only ${alternates.length} hreflang alternates`)
  for (const [, href] of alternates) if (hostOf(href) !== host) problems.push(`hreflang points at ${hostOf(href)}`)
  return problems
})

await check('4 sitemap hosts', async () => {
  const problems = []
  const index = await (await get('/sitemap-index.xml')).text()
  const sitemaps = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  if (!sitemaps.length) return ['sitemap-index.xml lists no sitemaps']
  const urls = []
  for (const sitemap of sitemaps) {
    if (hostOf(sitemap) !== host) problems.push(`sitemap at ${hostOf(sitemap)}`)
    const body = await (await fetch(sitemap)).text()
    urls.push(...[...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]))
  }
  if (urls.length < 60) problems.push(`only ${urls.length} URLs, expected at least 60`)
  const wrongHost = urls.filter((u) => hostOf(u) !== host)
  if (wrongHost.length) problems.push(`${wrongHost.length} URLs on another host, e.g. ${wrongHost[0]}`)
  const leaked = urls.filter((u) => /\/(admin|keystatic)/.test(u))
  if (leaked.length) problems.push(`admin URLs in the sitemap, e.g. ${leaked[0]}`)
  return problems
})

await check('5 legacy redirects', async () => {
  const problems = []
  for (const path of LEGACY_PATHS) {
    let response = await get(path, { redirect: 'manual' })
    const first = response.status
    if (![200, 301, 307, 308].includes(first)) {
      problems.push(`${path} answered ${first}`)
      continue
    }
    let hops = 0
    while (response.status >= 300 && response.status < 400 && hops++ < 5) {
      response = await fetch(new URL(response.headers.get('location'), origin + path), { redirect: 'manual' })
    }
    if (response.status !== 200) problems.push(`${path} ends at ${response.status}`)
    else if (hostOf(response.url || origin) !== host) problems.push(`${path} ends on ${hostOf(response.url)}`)
  }
  return problems
})

await check('6 legal pages', async () => {
  const problems = []
  for (const path of ['/impressum/', '/datenschutz/']) {
    const status = (await get(path)).status
    if (status !== 200) problems.push(`${path} answered ${status}`)
  }
  return problems
})

await check('7 mail links use this origin', async () => {
  const source = readFileSync(new URL('../src/newsletter/email.ts', import.meta.url), 'utf8')
  const match = source.match(/SITE_ORIGIN\s*=\s*'([^']+)'/)
  if (!match) return ['SITE_ORIGIN not found in src/newsletter/email.ts']
  return match[1] === origin ? [] : [`SITE_ORIGIN is ${match[1]}, expected ${origin}`]
})

await check('8 worker route', async () => {
  const config = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
  return config.includes(`"pattern": "${host}"`) ? [] : [`wrangler.jsonc has no route for ${host}`]
})

await check('9 no truncated descriptions', async () => {
  const problems = []
  for (const path of ['/', ...PROJECT_PAGES]) {
    const html = await (await get(path)).text()
    const description = html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? ''
    if (!description) problems.push(`${path} has no description`)
    else if (/(…|\.\.\.|&#8230;)$/.test(description.trim())) problems.push(`${path} description ends cut off`)
  }
  return problems
})

await check('10 contact form refuses a malformed body', async () => {
  const response = await get('/api/kontakt', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', 'user-agent': 'verify-origin' },
    body: 'null',
  })
  return response.status === 400 ? [] : [`POST /api/kontakt with a null body answered ${response.status}, expected 400`]
})

const width = Math.max(...results.map((r) => r.name.length))
console.log(`\n${origin}  (${modeArg})\n`)
for (const { name, ok, detail } of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(width)}${ok ? '' : `  ${detail}`}`)
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed ? 1 : 0)
