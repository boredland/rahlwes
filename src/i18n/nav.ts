import { localizePath, type Locale } from './config'
import { useTranslations, type UIKey } from './ui'

type NavRoute = { key: UIKey; path: string }

/** Paths are locale-agnostic; `localizePath` adds the prefix for non-default locales. */
const routes: NavRoute[] = [
  { key: 'nav.about', path: '/ueber-mich' },
  { key: 'nav.projects', path: '/projekte' },
  { key: 'nav.journal', path: '/journal' },
  { key: 'nav.contact', path: '/kontakt' },
]

export function getNavItems(locale: Locale) {
  const t = useTranslations(locale)
  return routes.map(({ key, path }) => ({
    label: t(key),
    href: localizePath(path, locale),
  }))
}
