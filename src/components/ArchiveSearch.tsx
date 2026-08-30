import { useState } from 'react'
import type { ArchiveRecord, LinkOut, ProviderInfo, SearchResponse } from '@ankai/types'

/**
 * Archive search across the sources registered in `src/ankai/providers.ts`.
 *
 * Ported from Ankai's HonoX island. The fan-out now runs in this worker, so requests go
 * to `/api/admin/ankai/search` and the Keystatic guard is the only gate. A 401 means
 * that session expired, so it reloads rather than sending the reader anywhere else.
 */

/** Wrap occurrences of a query token in a highlight — token-based, so "rene weiß" marks both. */
function Highlight({ text, query }: { text: string; query?: string }) {
  const tokens = new Set(
    (query ?? '')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu)
      ?.filter((t) => t.length >= 2),
  )
  if (tokens.size === 0) return <>{text}</>

  return (
    <>
      {text.split(/(\p{L}[\p{L}\p{N}]*)/u).map((part, i) =>
        tokens.has(part.toLowerCase()) ? (
          <mark key={i} className="archive-mark">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  )
}

export default function ArchiveSearch({ sources: catalog }: { sources: ProviderInfo[] }) {
  const [name, setName] = useState('')
  const [keywords, setKeywords] = useState('')
  const [expandNames, setExpandNames] = useState(false)
  const [sources, setSources] = useState<string[]>(catalog.map((s) => s.id))
  const [data, setData] = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggleSource = (id: string) =>
    setSources((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]))

  const run = async (cursor?: string) => {
    if (!name) return
    setLoading(true)
    setError(null)

    const params = new URLSearchParams({ name })
    if (keywords) params.set('keywords', keywords)
    if (expandNames) params.set('expandNames', 'true')
    // Omitted entirely when everything is selected, so the server applies its own default.
    if (sources.length && sources.length < catalog.length) params.set('sources', sources.join(','))
    if (cursor) params.set('cursor', cursor)

    try {
      const response = await fetch(`/api/admin/ankai/search?${params}`, {
        headers: { accept: 'application/json' },
      })
      if (response.status === 401) {
        window.location.reload()
        return
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null
        throw new Error(body?.message ?? `HTTP ${response.status}`)
      }
      setData((await response.json()) as SearchResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="archive">
      <form
        className="archive-form"
        onSubmit={(e) => {
          e.preventDefault()
          void run()
        }}
      >
        <div className="archive-fields">
          <label>
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Sally Fleisch" />
          </label>
          <label>
            <span>Weitere Begriffe</span>
            <input
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="z. B. Frankfurt, Rückerstattung — beeinflusst nur die Sortierung"
            />
          </label>
        </div>

        <div className="archive-sources">
          {catalog.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => toggleSource(s.id)}
              aria-pressed={sources.includes(s.id)}
              className={sources.includes(s.id) ? 'archive-chip is-on' : 'archive-chip'}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="archive-actions">
          <label className="archive-check">
            <input type="checkbox" checked={expandNames} onChange={() => setExpandNames(!expandNames)} />
            Namensvarianten erweitern (GND)
          </label>
          <button type="submit" disabled={loading || !name} className="archive-submit">
            {loading ? 'Suche läuft …' : 'Suchen'}
          </button>
        </div>
      </form>

      {error ? <p className="archive-error">Fehler: {error}</p> : null}
      {data ? <Results data={data} onPage={(cursor) => run(cursor)} /> : null}
    </div>
  )
}

function Results({ data, onPage }: { data: SearchResponse; onPage: (cursor: string) => void }) {
  const query = [data.query.name, data.query.keywords].filter(Boolean).join(' ')

  return (
    <div className="archive-results">
      <div className="archive-status">
        {Object.entries(data.perSource).map(([id, s]) => (
          <span key={id} className={`archive-pill${!s.ok ? ' is-error' : s.stale ? ' is-stale' : ''}`} title={s.error ?? ''}>
            {id}: {s.ok ? (s.total ?? s.returned ?? 0) : 'Fehler'}
            {s.stale ? ' (veraltet)' : ''}
          </span>
        ))}
      </div>

      {data.results.length === 0 ? (
        <p className="archive-empty">Keine Treffer in den durchsuchten Beständen. Die externen Suchen unten können weiterhelfen.</p>
      ) : (
        <ul className="archive-list">
          {data.results.map((r) => (
            <ResultCard key={`${r.source}:${r.sourceId}`} record={r} query={query} />
          ))}
        </ul>
      )}

      {data.query.cursor ? (
        <button type="button" className="archive-more" onClick={() => onPage(data.query.cursor!)}>
          Mehr laden
        </button>
      ) : null}

      {data.linkouts.length ? <LinkOuts links={data.linkouts} /> : null}
    </div>
  )
}

function ResultCard({ record: r, query }: { record: ArchiveRecord; query?: string }) {
  const born = [r.birth?.date, r.birth?.place].filter(Boolean).join(' ')

  return (
    <li className="archive-card">
      <a href={r.landingUrl} target="_blank" rel="noreferrer">
        <Highlight text={r.personName ?? r.title ?? r.sourceId} query={query} />
      </a>
      <div className="archive-meta">
        <span className="archive-source">{r.source}</span>
        {r.documentType ? <span>{r.documentType}</span> : null}
        {r.holdingInstitution ? <span>{r.holdingInstitution}</span> : null}
        {r.reference ? <span>{r.reference}</span> : null}
        {born ? <span>* {born}</span> : null}
      </div>
      {r.preview ? (
        <p className="archive-preview">
          <Highlight text={r.preview} query={query} />
        </p>
      ) : r.accessNote ? (
        <p className="archive-preview">{r.accessNote}</p>
      ) : null}
    </li>
  )
}

function LinkOuts({ links }: { links: LinkOut[] }) {
  return (
    <div className="archive-linkouts">
      <h2>Externe Bestände durchsuchen</h2>
      <ul>
        {links.map((l) => (
          <li key={l.url}>
            <a href={l.url} target="_blank" rel="noreferrer">
              {l.label}
            </a>
            {l.note ? <span className="archive-note">{l.note}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
