import type { Locale } from '@i18n/config'

export type Subscriber = {
  id: number
  email: string
  /** One of the site's three languages; decides which language we mail them. */
  locale: Locale
  /** Raw `Accept-Language` preference, which may name a language the site lacks. */
  browser_locale: string
  verified: number
  verify_token: string | null
  unsubscribe_token: string
  created_at: string
  /** Set once the address hard-bounced or was suppressed; such rows are never mailed. */
  bounced_at: string | null
  bounce_reason: string | null
}

export type Campaign = {
  id: number
  slug: string
  locale: Locale
  subject: string
  html: string
  text: string
  created_at: string
}

/** Addresses differing only in case are the same mailbox in practice; store one form. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * Deliberately loose: the confirmation mail is the real check. A stricter pattern
 * rejects valid addresses, and an address that survives this but does not exist
 * simply never gets confirmed.
 */
export function isEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export function findByVerifyToken(db: D1Database, token: string) {
  return db.prepare('SELECT * FROM subscribers WHERE verify_token = ?').bind(token).first<Subscriber>()
}

export function findByUnsubscribeToken(db: D1Database, token: string) {
  return db.prepare('SELECT * FROM subscribers WHERE unsubscribe_token = ?').bind(token).first<Subscriber>()
}

/**
 * The recipients of a dispatch: confirmed, and not known to be undeliverable.
 * Mailing a suppressed address only adds to the bounce rate, since Cloudflare
 * rejects it anyway.
 */
export function listVerified(db: D1Database) {
  return db
    .prepare('SELECT * FROM subscribers WHERE verified = 1 AND bounced_at IS NULL ORDER BY id')
    .all<Subscriber>()
    .then((r) => r.results)
}

/** Bounced rows stay on the list, so the admin table can show why they stopped. */
export function countBounced(db: D1Database) {
  return db
    .prepare('SELECT COUNT(*) AS n FROM subscribers WHERE bounced_at IS NOT NULL')
    .first<{ n: number }>()
    .then((r) => r?.n ?? 0)
}

export function listAll(db: D1Database) {
  return db
    .prepare('SELECT * FROM subscribers ORDER BY created_at DESC, id DESC')
    .all<Subscriber>()
    .then((r) => r.results)
}
