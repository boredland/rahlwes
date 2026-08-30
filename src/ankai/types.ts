/**
 * The subset of Ankai's API contract this UI consumes.
 *
 * Ankai (`search.rahlwes.eu`) stays the owner of the schema: these are hand-mirrored
 * from its `src/types.ts` rather than imported, because it is a separate HonoX worker
 * with its own build. Only the response shape is duplicated — adapters, the provider
 * catalog and the Zod schemas stay there.
 *
 * `/api/admin/ankai/sources` returns the live catalog, so the source toggles cannot
 * drift even though these types are a copy.
 */

export interface ProviderInfo {
  id: string
  label: string
  kind: 'records' | 'authority' | 'linkout'
}

/** Provenance hint from the holding collection, never a verdict about a person. */
export type RoleHint = 'victim' | 'perpetrator' | 'unknown'

export interface ArchiveRecord {
  source: string
  sourceId: string
  personName?: string
  role?: RoleHint
  birth?: { date?: string; place?: string }
  death?: { date?: string; place?: string }
  documentType?: string
  holdingInstitution?: string
  reference?: string
  title?: string
  landingUrl: string
  preview?: string
  accessNote?: string
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
  query: { name?: string; keywords?: string; cursor?: string }
  results: ArchiveRecord[]
  linkouts: LinkOut[]
  perSource: Record<string, PerSourceStatus>
}
