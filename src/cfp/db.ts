/**
 * Calls for proposals collected by `scripts/scrape-cfps.mjs` and committed to
 * `src/data/cfps.json`.
 *
 * The store is a file rather than a table because it is written by a GitHub
 * Action, reviewed in the commit diff, and only ever read by the admin page: a
 * database would put it out of reach of both `git log` and a rollback.
 */
export type Cfp = {
  /** Stable across runs: derived from the URL, which is what dedupes the feed. */
  id: string
  title: string
  /** Key into `cfpSources`, naming which feed produced the entry. */
  source: string
  url: string
  /** ISO date the source published the item, or the harvest date when it gives none. */
  date: string
  /** Submission deadline as printed by the source (DD.MM.YYYY), when it states one. */
  deadline: string
  /** Freelance or location-independent work, rather than a call for papers. */
  remote: boolean
  description: string
  /** When our scraper first saw it; drives "new since yesterday" in the digest. */
  first_seen: string
}

export type CfpSubscriber = {
  id: number
  email: string
  unsubscribe_token: string
  created_at: string
}

/**
 * Human-readable names for the `source` field.
 *
 * Kept beside the type rather than in the scraper so the admin page can label a
 * row whose source has since been retired from the scraper.
 */
export const cfpSourceName: Record<string, string> = {
  arthist: 'ArtHist.net',
  'h-net': 'H-Net Announcements',
  icom: 'ICOM Deutschland',
  'royal-historical-society': 'Royal Historical Society (London)',
  prohelvetia: 'Pro Helvetia (Schweiz)',
  'stadt-koeln-foerderung': 'Stadt Köln (Kulturförderung)',
  evz: 'Stiftung EVZ (Erinnerungskultur)',
  'remote-work': 'Kultur Management Network (Aufträge)',
  kulturmanagement: 'Kultur Management Network',
  'stadt-koeln': 'Stadt Köln (Presse)',
}

export function listCfpSubscribers(db: D1Database) {
  return db
    .prepare('SELECT * FROM cfp_subscribers ORDER BY created_at DESC, id DESC')
    .all<CfpSubscriber>()
    .then((r) => r.results)
}
