/**
 * Permanent redirects from the Squarespace URLs to their equivalents here.
 *
 * Every path that ever appeared in the old sitemap or was linked from the old
 * navigation is mapped, so nothing that search engines or existing links point
 * at will 404 once this replaces rahlwes.eu. Astro emits these as 301s.
 *
 * The journal slugs are unchanged, but Squarespace served them without a
 * trailing slash while this site uses one, so they are listed too.
 */
export const legacyRedirects = {
  // Service overview — its content is the homepage.
  '/leistungen': '/',

  '/uebermich': '/ueber-mich/',
  '/museen': '/fuer-museen/',

  // Exhibition and project references.
  '/ausstellung-forschung': '/projekte/ausstellung-und-forschung/',
  '/nal': '/projekte/notaufnahmelager-giessen/',
  '/familie-frank': '/projekte/wir-sind-jetzt/',
  '/familie': '/projekte/wir-sind-jetzt/',
  '/nachgefragt': '/projekte/nachgefragt/',
  '/provenienzforschung': '/projekte/geerbt-gekauft-geraubt/',
  '/digitales-storytelling': '/projekte/digitales-storytelling/',
  '/unterrichtsmaterial': '/projekte/unterrichtsmaterial/',
  // Squarespace already redirected this one to /digitales-storytelling.
  '/referenzen-1': '/projekte/digitales-storytelling/',

  // Journal slugs are unchanged, so the unslashed old URLs are handled by the
  // platform's own trailing-slash normalisation. That emits a 307 rather than a
  // 301 — link equity still passes, and Workers Assets does not let the status
  // be configured (html_handling changes the behaviour, not the code).

  // The English journal had one article; both it and its index move to /en/.
  '/journal-en': '/en/journal/',
  '/journal-en/the-frankfurt-history-app': '/en/journal/orteerforschen/',


  // The contact form now closes every page, so the standalone page it used to live
  // on is gone. The original Squarespace site had no contact page either.
  '/kontakt': '/#kontakt',
  '/en/kontakt': '/en/#kontakt',
  '/fr/kontakt': '/fr/#kontakt',
} as const satisfies Record<string, string>
