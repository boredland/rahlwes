import themeConfig from '@theme-config'
import { htmlLang, localizePath, type Locale } from './config'
import { useTranslations } from './ui'

/** Stable @id so every page's JSON-LD references the same Person node. */
export const personId = 'https://rahlwes.eu/#person'
const siteId = 'https://rahlwes.eu/#website'

export function personSchema(locale: Locale, site: URL | undefined) {
  const t = useTranslations(locale)
  return {
    '@type': 'Person',
    '@id': personId,
    name: themeConfig.name,
    jobTitle: t('site.tagline'),
    description: t('site.description'),
    url: new URL(localizePath('/', locale), site).href,
    email: 'info@rahlwes.eu',
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Frankfurt am Main',
      addressCountry: 'DE',
    },
    knowsLanguage: ['de', 'en', 'fr'],
    sameAs: (themeConfig.socials ?? [])
      .map((social) => social.href)
      .filter((href) => href.startsWith('http')),
    knowsAbout: [
      'Geschichtswissenschaft',
      'Provenienzforschung',
      'Objektgeschichte',
      'Familienforschung',
      'Ausstellungskonzeption',
      'Digitale Kulturvermittlung',
    ],
  }
}

export function websiteSchema(locale: Locale, site: URL | undefined) {
  const t = useTranslations(locale)
  return {
    '@type': 'WebSite',
    '@id': siteId,
    name: themeConfig.name,
    description: t('site.description'),
    url: new URL(localizePath('/', locale), site).href,
    inLanguage: htmlLang[locale],
    publisher: { '@id': personId },
  }
}

type ArticleInput = {
  /** `BlogPosting` for journal entries, `WebPage` for static pages and projects. */
  kind?: 'BlogPosting' | 'WebPage'
  title: string
  description: string
  url: string
  image?: string | null
  published?: Date
  locale: Locale
}

export function articleSchema({ kind = 'BlogPosting', title, description, url, image, published, locale }: ArticleInput) {
  return {
    '@type': kind,
    headline: title,
    description,
    url,
    inLanguage: htmlLang[locale],
    ...(image ? { image } : {}),
    ...(published ? { datePublished: published.toISOString() } : {}),
    author: { '@id': personId },
    publisher: { '@id': personId },
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
  }
}

/** Breadcrumbs give search results a readable path instead of a bare URL. */
export function breadcrumbSchema(trail: { name: string; url: string }[]) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  }
}
