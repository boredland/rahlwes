export const locales = ['de', 'en', 'fr'] as const
export const defaultLocale = 'de' satisfies Locale

export type Locale = (typeof locales)[number]

/** BCP-47 tags for `<html lang>`, hreflang and Open Graph. */
export const htmlLang: Record<Locale, string> = {
  de: 'de-DE',
  en: 'en-GB',
  fr: 'fr-FR',
}

export const localeName: Record<Locale, string> = {
  de: 'Deutsch',
  en: 'English',
  fr: 'Français',
}

export function isLocale(value: string | undefined): value is Locale {
  return !!value && (locales as readonly string[]).includes(value)
}

/** `Astro.currentLocale` is typed as `string | undefined`; narrow it with the default as fallback. */
export function currentLocale(value: string | undefined): Locale {
  return isLocale(value) ? value : defaultLocale
}

/** Prefix a root-relative path with the locale, leaving the default locale unprefixed. */
export function localizePath(path: string, locale: Locale): string {
  const normalized = path.startsWith('/') ? path : `/${path}`
  if (locale === defaultLocale) return normalized
  return normalized === '/' ? `/${locale}/` : `/${locale}${normalized}`
}

/** Strip a locale prefix, yielding the path as it appears in the default locale. */
export function stripLocale(pathname: string): string {
  for (const locale of locales) {
    if (pathname === `/${locale}` || pathname === `/${locale}/`) return '/'
    if (pathname.startsWith(`/${locale}/`)) return pathname.slice(locale.length + 1)
  }
  return pathname
}
