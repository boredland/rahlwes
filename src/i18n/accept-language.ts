import { defaultLocale, isLocale, type Locale } from './config'

type Ranked = { tag: string; quality: number }

/**
 * Parses an `Accept-Language` header into tags ordered by preference.
 *
 * Browsers send a weighted list (`de-AT,de;q=0.9,en;q=0.7`). Reading only the first
 * entry looks right until someone's browser leads with a language we do not publish,
 * so the whole list is ranked and the caller picks the best tag it can serve.
 */
export function parseAcceptLanguage(header: string | null | undefined): Ranked[] {
  if (!header) return []

  return header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';')
      const q = params.find((p) => p.trim().startsWith('q='))
      // A malformed q value means "unweighted" per RFC 9110, which is q=1.
      const quality = q ? Number.parseFloat(q.trim().slice(2)) : 1
      return { tag: (tag ?? '').trim(), quality: Number.isFinite(quality) ? quality : 1 }
    })
    .filter((entry) => entry.tag && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality)
}

/** The raw tag to store: the reader's own first choice, however exotic. */
export function browserLocaleTag(header: string | null | undefined): string {
  const [best] = parseAcceptLanguage(header)
  if (!best || best.tag === '*') return defaultLocale
  // Keep the region ("de-AT" tells us more than "de") but bound the length, since
  // this lands in a database column and the header is attacker-controlled.
  return best.tag.slice(0, 35)
}

/**
 * The best language we can actually mail, which is a different question: only the
 * three the site publishes are on offer, and a `de-AT` reader gets German.
 */
export function matchLocale(header: string | null | undefined): Locale | null {
  for (const { tag } of parseAcceptLanguage(header)) {
    if (tag === '*') return defaultLocale
    const base = tag.split('-')[0]?.toLowerCase()
    if (isLocale(base)) return base
  }
  return null
}
