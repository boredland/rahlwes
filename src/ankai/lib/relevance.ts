import type { ArchiveRecord, PersonQuery } from "../types";

/**
 * Cross-source relevance scoring. Upstreams (EHRI Solr, Arolsen phonetic, DDB cursor, …)
 * don't expose comparable relevance scores, so we can't merge on theirs. Instead we score
 * each *normalized* record uniformly, giving one scale every source shares.
 *
 * The guiding principle is **where** the query lands, not just whether it appears: a record
 * whose person-name is the searched name — as an adjacent phrase, in either order — is a far
 * stronger hit than one that merely mentions the same words scattered across its description
 * (which many providers return via loose full-text matching). Scores are tiered with wide
 * gaps so a name-phrase hit always outranks a scatter hit.
 *
 * `keywords` are *additional* words that only boost/re-rank results found by name — they are
 * never sent to the upstreams, just matched against the returned records.
 */

const PHRASE_IN_NAME = 1000; // query is the person's name, adjacent (e.g. "Rene Weiss")
const ALL_IN_NAME = 450; // all name tokens in the person's name, not adjacent
const PHRASE_IN_TITLE = 300; // query adjacent in the record title
const KEYWORD_HIT = 40; // each additional keyword found anywhere

/**
 * Normalize German orthography so spelling variants match: ß→ss, umlauts→ae/oe/ue, and any
 * remaining diacritics stripped (é→e). Without this "Weiß" (record) never matches the typed
 * "Weiss", so real person records lose to free-text hits.
 */
function normalize(text: string): string {
  // ß→ss (no single base letter); then NFD-decompose and drop combining marks so umlauts and
  // accents fold to their base letter (ü→u, é→e). This matches how researchers actually type
  // ("muller", "weiss") and folds the record's "Müller"/"Weiß" to the same tokens.
  return text
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Normalized alphanumeric tokens of a string, deduped, length ≥ 2. */
export function tokenize(text: string | undefined): string[] {
  return [...new Set(normalize(text ?? "").match(/[\p{L}\p{N}]+/gu) ?? [])].filter((t) => t.length >= 2);
}

/** The name tokens to match: the searched name plus any GND-attested variants. */
export function nameTokens(q: PersonQuery): string[] {
  return tokenize([q.name, ...(q.nameVariants ?? [])].filter(Boolean).join(" "));
}

/** Additional keyword tokens: rank-only, never sent upstream. */
export function keywordTokens(q: PersonQuery): string[] {
  return tokenize(q.keywords);
}

/**
 * Score one record. Name relevance dominates via tiers (phrase-in-name > all-in-name >
 * scattered), keywords add a flat boost per hit. Tolerant of Arolsen-style `?` garbling.
 */
export function scoreRecord(name: string[], keywords: string[], r: ArchiveRecord): number {
  const personName = normalize(r.personName ?? "");
  const title = normalize(r.title ?? "");
  const places = normalize([r.birth?.place, r.death?.place].filter(Boolean).join(" "));
  const context = normalize([r.preview, r.reference, r.holdingInstitution].filter(Boolean).join(" "));

  let score = 0;
  if (name.length > 0) {
    const pnWords = words(personName);
    if (isPhrase(name, pnWords)) score += PHRASE_IN_NAME;
    else if (allPresent(name, pnWords)) score += ALL_IN_NAME;
    else score += tokenSum(name, personName);

    if (isPhrase(name, words(title))) score += PHRASE_IN_TITLE;
    else score += 0.6 * tokenSum(name, title);

    score += 0.3 * tokenSum(name, places);
    // The weakest tier: name words merely present in the free-text description. This is the
    // "found both words somewhere in the content" case we want ranked below real name hits.
    score += 0.15 * tokenSum(name, context);
  }

  const haystack = `${personName} ${title} ${places} ${context}`;
  for (const kw of keywords) if (fieldScore(kw, haystack) > 0) score += KEYWORD_HIT;
  return score;
}

const words = (field: string): string[] => field.match(/[\p{L}\p{N}]+/gu) ?? [];

/** True if `tokens` appear as one contiguous run in `fieldWords`, in any order (a phrase). */
function isPhrase(tokens: string[], fieldWords: string[]): boolean {
  if (tokens.length < 2) return tokens.length === 1 && fieldWords.includes(tokens[0]!);
  const want = new Set(tokens);
  for (let i = 0; i + tokens.length <= fieldWords.length; i++) {
    const window = fieldWords.slice(i, i + tokens.length);
    if (window.length === want.size && window.every((w) => want.has(w)) && new Set(window).size === want.size) {
      return true;
    }
  }
  return false;
}

/** True if every token appears somewhere in the field's words (order/adjacency ignored). */
function allPresent(tokens: string[], fieldWords: string[]): boolean {
  const present = new Set(fieldWords);
  return tokens.every((t) => present.has(t) || fieldWords.some((w) => w.startsWith(t)));
}

function tokenSum(tokens: string[], field: string): number {
  let sum = 0;
  for (const t of tokens) sum += fieldScore(t, field);
  return sum;
}

/** Best per-word match of `token` within a field. Tolerant of `?`-garbled words. */
function fieldScore(token: string, field: string): number {
  let best = 0;
  for (const word of field.split(/\s+/)) {
    if (!word) continue;
    if (word === token) best = Math.max(best, 100);
    else if (word.startsWith(token)) best = Math.max(best, 60);
    else if (word.includes(token)) best = Math.max(best, 40);
    else {
      const clean = word.replace(/\?/g, "");
      if (clean.length >= 3 && token.includes(clean)) best = Math.max(best, 45);
    }
  }
  return best;
}

/**
 * Merge per-source result lists into one cross-source ranking. Primary sort is relevance;
 * within a relevance band we round-robin across sources (via each record's within-source
 * rank) so one prolific source can't bury another's equally-good hit. Records that don't
 * match keep source order at the tail rather than being dropped.
 */
export function rankAcrossSources(q: PersonQuery, buckets: ArchiveRecord[][]): ArchiveRecord[] {
  const name = nameTokens(q);
  const keywords = keywordTokens(q);
  const scored = buckets.flatMap((records) =>
    records.map((record, rank) => ({ record, rank, score: scoreRecord(name, keywords, record) })),
  );
  return scored.sort((a, b) => b.score - a.score || a.rank - b.rank).map((x) => x.record);
}
