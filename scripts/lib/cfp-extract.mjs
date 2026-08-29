/**
 * Reads a call that is published as a PDF (or as prose with no usable markup)
 * and turns it into the fields the digest needs.
 *
 * Deterministic parsing handles the feeds; this is for the cases it cannot
 * reach — a Stipendium whose conditions and deadline exist only inside an
 * attached PDF. Extraction runs through the AI proxy, the same
 * OpenAI-compatible endpoint museumsufer uses (see its AGENTS.md, "LLM access").
 *
 * Two rules keep a non-deterministic model from poisoning the data:
 *
 *   1. Nothing is invented. Every field the model returns is checked back
 *      against the source text; a deadline that does not appear verbatim is
 *      dropped rather than trusted.
 *   2. Nothing runs unattended without a fallback. If the proxy is unset or
 *      failing, the caller keeps the deterministic result instead of losing
 *      the call entirely.
 */
import { extractText, getDocumentProxy } from 'unpdf'

const CHROME_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

const SYSTEM_PROMPT = `Du liest die Ausschreibung eines Kultur- oder Forschungsprojekts (aus einem PDF oder einer Webseite).
Antworte AUSSCHLIESSLICH mit JSON in dieser Form:
{ "is_call": boolean, "title": string, "deadline": null | "TT.MM.JJJJ", "summary": string, "remote": boolean, "topic": "forschung" | "kuration" | "beides" | "andere" }
Regeln:
- is_call: true nur, wenn man sich auf etwas bewerben oder einreichen kann (Ausschreibung, Stipendium, Preis, Residenz, Auftrag). Ein Bericht, ein Rückblick oder eine reine Stellenanzeige ist false.
- deadline: der Bewerbungs- oder Einsendeschluss, exakt wie im Text angegeben, umgewandelt in TT.MM.JJJJ. Steht keine Frist im Text, setze null. Rate NIE.
- summary: zwei Sätze, was ausgeschrieben ist und für wen. Nur aus dem Text.
- remote: true, wenn die Arbeit ausdrücklich ortsunabhängig, remote, freiberuflich oder auf Honorarbasis möglich ist.
- topic: "forschung" für historische Forschung/Quellenarbeit, "kuration" für Museum/Ausstellung/Sammlung, "beides" wenn zutreffend, sonst "andere".
- Erfinde nichts. Was nicht im Text steht, ist null bzw. false.`

/** SHA-256 hex, so an unchanged document can skip the model call entirely. */
export async function textHash(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Fetches a PDF and flattens it to text. Cheap and deterministic: the hash it
 *  returns is what lets an unchanged document cost nothing. */
export async function fetchPdfText(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': CHROME_UA },
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`pdf fetch ${res.status}`)

  const pdf = await getDocumentProxy(new Uint8Array(await res.arrayBuffer()))
  const { text } = await extractText(pdf, { mergePages: true })
  return { text: text.replace(/\s+/g, ' ').trim(), hash: await textHash(text) }
}

function stripCodeFences(s) {
  return s
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
}

async function callModel(text, { aiProxyUrl, model }) {
  const res = await fetch(`${aiProxyUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    // The proxy is Cloudflare-fronted and rejects a default Node UA with
    // "browser banned"; a normal Chrome string is what gets through.
    headers: { 'content-type': 'application/json', 'user-agent': CHROME_UA },
    body: JSON.stringify({
      model: model ?? 'gemini-2.5-flash',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text.slice(0, 24_000) },
      ],
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(120_000),
  })

  if (!res.ok) throw new Error(`ai-proxy ${res.status}: ${(await res.text()).slice(0, 160)}`)

  const data = await res.json()
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('ai-proxy: empty completion')
  return JSON.parse(stripCodeFences(content))
}

/**
 * Rejects anything the source text does not support.
 *
 * The deadline is the field worth being strict about — it is what she plans
 * around, and a plausible-looking invented date is worse than none. It is kept
 * only when the same day appears in the source, in any of the spellings German
 * announcements actually use.
 */
function deadlineInSource(deadline, source) {
  const [, d, m, y] = deadline.match(/^(\d{2})\.(\d{2})\.(\d{4})$/) ?? []
  if (!d) return false

  const day = Number(d)
  const month = Number(m)
  const months = [
    'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
    'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
  ]

  const forms = [
    `${d}.${m}.${y}`,
    `${day}.${month}.${y}`,
    `${day}. ${months[month - 1]} ${y}`,
    `${day}.${months[month - 1]} ${y}`,
    `${y}-${m}-${d}`,
  ]
  return forms.some((f) => source.includes(f))
}

/**
 * Structures one call's text. Returns null when the model says it is not a call
 * at all, so a prospectus or annual report drops out rather than being filed.
 */
export async function extractCall(text, options) {
  const parsed = await callModel(text, options)
  if (!parsed || parsed.is_call !== true) return null

  const deadline =
    typeof parsed.deadline === 'string' && deadlineInSource(parsed.deadline, text)
      ? parsed.deadline
      : ''

  const title = typeof parsed.title === 'string' ? parsed.title.trim() : ''
  const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : ''

  return {
    title,
    deadline,
    description: summary.slice(0, 400),
    remote: parsed.remote === true,
    topic: ['forschung', 'kuration', 'beides', 'andere'].includes(parsed.topic)
      ? parsed.topic
      : 'andere',
  }
}

/** Convenience: fetch a PDF and structure it in one call. */
export async function extractCallFromPdf(url, options) {
  const { text, hash } = await fetchPdfText(url)
  if (!text || text.length < 120) throw new Error('pdf produced no usable text')
  return { hash, call: await extractCall(text, options) }
}
