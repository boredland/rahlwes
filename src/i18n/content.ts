import { getCollection, getEntry, type CollectionEntry } from 'astro:content'
import { defaultLocale, isLocale, type Locale } from './config'

type LocalizedCollection = 'journal' | 'projects' | 'pages'

/** Entry ids are `<locale>/<slug>`; the slug is what appears in the URL. */
export function splitId(id: string): { locale: Locale; slug: string } {
  const [maybeLocale, ...rest] = id.split('/')
  return {
    locale: isLocale(maybeLocale) ? maybeLocale : defaultLocale,
    slug: rest.join('/') || maybeLocale,
  }
}

export async function getLocalized<C extends LocalizedCollection>(
  collection: C,
  locale: Locale,
): Promise<CollectionEntry<C>[]> {
  return getCollection(collection, ({ id }) => splitId(id).locale === locale)
}

export async function getJournal(locale: Locale, includeDrafts = false) {
  const entries = await getLocalized('journal', locale)
  return entries
    .filter((entry) => includeDrafts || !entry.data.draft)
    .sort((a, b) => b.data.publishedAt.valueOf() - a.data.publishedAt.valueOf())
}

export async function getProjects(locale: Locale) {
  const entries = await getLocalized('projects', locale)
  return entries.sort((a, b) => a.data.order - b.data.order)
}

/**
 * Falls back to German so a page she has not translated yet still renders
 * instead of 404-ing. Callers surface the fallback with a notice.
 */
export async function getHome(locale: Locale) {
  const entry = (await getEntry('home', locale)) ?? (await getEntry('home', defaultLocale))
  if (!entry) throw new Error('No home content found for any locale — run Keystatic and fill the Startseite singleton.')
  return entry
}
