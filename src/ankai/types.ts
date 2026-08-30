/**
 * Ankai's domain types, ported from the standalone worker.
 *
 * The originals were Zod schemas from `@hono/zod-openapi`, which existed to generate the
 * OpenAPI document for its Scalar docs page. Nothing here serves that document, and the
 * only untrusted input is the query string — validated where it is parsed, in
 * `src/pages/api/admin/ankai/search.ts` — so these are plain interfaces and the dependency
 * is gone.
 */

/** Provenance hint derived from the holding collection. Never a verdict about a person. */
export type RoleHint = 'victim' | 'perpetrator' | 'unknown'

export interface PersonEvent {
  type: string
  date?: string
  place?: string
}

export interface ArchiveRecord {
  source: string
  sourceId: string
  personName?: string
  role?: RoleHint
  birth?: { date?: string; place?: string }
  death?: { date?: string; place?: string }
  events?: PersonEvent[]
  documentType?: string
  holdingInstitution?: string
  reference?: string
  title?: string
  landingUrl: string
  /** Short excerpt of the finding text (scope & content). */
  preview?: string
  accessNote?: string
  raw?: unknown
}

/** Normalized query passed to every adapter. */
export interface PersonQuery {
  name?: string
  keywords?: string
  birthYear?: number
  deathYear?: number
  limit: number
  cursor?: string
  nameVariants?: string[]
}

export interface AdapterResult {
  records: ArchiveRecord[]
  total?: number
  cursor?: string
  degraded?: boolean
}

/**
 * What an adapter is handed. `env` is the Worker environment: adapters reach for
 * `CACHE`, `DB` and the upstream API keys through it.
 */
export interface Ctx {
  env: AnkaiEnv
  signal: AbortSignal
}

/**
 * The bindings the archive code needs. A structural subset of the Worker `Env` rather
 * than the whole thing, so an adapter cannot quietly reach for the newsletter database.
 */
export interface AnkaiEnv {
  ANKAI_DB: D1Database
  ANKAI_CACHE: KVNamespace
  DDB_API_KEY?: string
  EHRI_TOKEN?: string
  GATEWAY_TIMEOUT_MS?: string
  FETCH_PROXY_URL?: string
  FETCH_PROXY_TOKEN?: string
}

export interface ArchiveAdapter {
  id: string
  label: string
  role: 'records' | 'authority' | 'linkout'
  search(q: PersonQuery, ctx: Ctx): Promise<AdapterResult>
  getRecord?(id: string, ctx: Ctx): Promise<ArchiveRecord | null>
}

export interface LinkOut {
  source: string
  label: string
  url: string
  note?: string
}

export interface PerSourceStatus {
  ok: boolean
  total?: number
  returned?: number
  cursor?: string
  stale?: boolean
  error?: string
}

export interface SearchResponse {
  query: PersonQuery
  results: ArchiveRecord[]
  linkouts: LinkOut[]
  perSource: Record<string, PerSourceStatus>
}

/** Serializable provider descriptor for the UI and the sources endpoint. */
export interface ProviderInfo {
  id: string
  label: string
  kind: 'records' | 'authority' | 'linkout'
}
