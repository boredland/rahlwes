/**
 * Collects Ausschreibungen — funding calls, stipends, prizes, residencies and
 * paid commissions — into src/data/cfps.json.
 *
 * Deliberately NOT calls for papers or abstracts. Those ask for an unpaid
 * submission to somebody else's proceedings; she is a practitioner looking for
 * work and funding, so `IS_PAPER_CALL` filters that whole class out. That is
 * also why the arthist reader took the STIP (stipend/fellowship) stream rather
 * than the far larger CFP one.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { extractCall, extractCallFromPdf } from './lib/cfp-extract.mjs'

const OUT = 'src/data/cfps.json'

/** Identifies us honestly and points at a page explaining the traffic. */
const USER_AGENT = 'rahlwes-cfp-scraper/1.0 (+https://next.rahlwes.eu/)'

const REQUEST_TIMEOUT = 30_000

/**
 * arthist.net asks for `Crawl-delay: 10` and H-Net for 5. Reading an abstract
 * costs one request per call, so the highest of the two is honoured throughout
 * rather than tracked per host: this runs nightly and has all the time it needs.
 */
const CRAWL_DELAY = 10_000

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * What counts as an opportunity worth surfacing: something to be commissioned,
 * funded or engaged for. Ausschreibungen, Stipendien, Preise, Residenzen and
 * paid commissions.
 */
const CFP_PATTERN =
  /\b(ausschreibung|ausgeschrieben|bewerbungsfrist|bewerbungsschluss|einsendeschluss|einreichfrist|wettbewerb|stipendi|fellowship|residen[zc]|residency|förderprogramm|förderung|preis\b|projektaufruf|interessenbekundung|call for (proposals|projects|participation|expressions?|tenders?)|open call|auftrag)\b/i

/**
 * Academic paper solicitations. She is a practitioner, not a conference author:
 * a call for papers asks for an unpaid submission to somebody else's
 * proceedings, which is not work.
 *
 * Checked before anything else, and independently of `CFP_PATTERN` — a call for
 * papers that also mentions a Preis or a Frist must still drop out.
 */
const IS_PAPER_CALL =
  /\b(cfp|cfa|call for (papers?|abstracts?|contributions?|submissions?|chapters?|articles?|panels?|sessions?)|papers? are invited|abstracts? are invited|beiträge werden erbeten|call for book reviews)\b/i

/**
 * Her subjects: history and the study of objects and sources, and the
 * curatorial/museum practice built on them.
 *
 * Vocabulary taken from her own project and journal pages, in both languages,
 * because the sources publish in German and English interchangeably.
 */
const TOPIC_PATTERN = new RegExp(
  [
    'kurat|curat|museum|museal|museen|ausstellung|exhibition|exhibit',
    'sammlung|collection|objekt|object|artefakt|artifact|exponat|schausammlung',
    'galerie|gallery|denkmal|heritage|kulturerbe|kulturgut|monument',
    'kunstgeschichte|art history|kunsthistor|visual culture|bildwissenschaft|material culture',
    'geschichte|history|historisch|historical|zeitgeschichte|erinnerungsort|erinnerungskultur|gedenkstaette|gedenkort|gedenkstätte',
    'quellen|archiv|archive|provenien|provenance|nachlass',
    'nationalsozial|holocaust|shoah|jüdisc|jewish|zwangsarbeit|verfolgung',
    'kulturvermittlung|public history|museumspädagog',
    // Art and its scholarship, which is where the curatorial calls sit even when
    // they never say "museum": journals and conferences of art theory.
    'kunst|art|kunstwissenschaft|art theory|kunsttheorie|fine art|bildende kunst',
    'visual art|performing art|contemporary art|art criticism|kunstkritik',
    // Scholarly framing: a call addressed to researchers is hers even when the
    // subject noun never appears.
    'forschung|forschen|research|scholarl|wissenschaftlich|humanities|geisteswissenschaft',
    // The cultural sector itself — funding, policy and institutional practice —
    // which is where the Kulturmanagement calls live.
    'kultur|cultural|kulturbetrieb|kulturpolitik|kulturfinanzierung|kultureinrichtung',
    // Gedenkstätten and remembrance culture — her strongest field, and one whose
    // calls rarely use the word "Museum" at all.
    'gedenkstätte|gedenkstaette|gedenkort|erinnerungsort|erinnerungskultur|memorial',
    'ns-unrecht|ns-geschichte|ns-zeit|zeitzeug|überlebende|remembrance|commemorat',
    'antisemitismus|antisemitism|antiziganismus|widerstand|deportation|lager\\b',
  ].join('|'),
  'i',
)

/**
 * Fields whose presence means the call belongs to someone else, however often it
 * says "history" in passing. Architectural history and urban studies cite the
 * word constantly; clinical education and public health are simply another
 * discipline. Checked only against a declared subject taxonomy, never free prose.
 */
const OFF_TOPIC_FIELDS =
  /health|medicine|clinical|nursing|social work|psychology|disability studies|teaching and learning|urban design|planning|architectur|engineering|economics|law\b|policy/i

const IS_FREELANCE =
  /\b(freie mitarbeit|freiberuflich|freelance|honorarbasis|honorarvertrag|werkvertrag|auftrag|remote|homeoffice|home[- ]office|ortsunhängig|projektbasis)\b/i

const IS_STIPEND =
  /\b(stipendi(?:um|en|at)|residenz-?stipendi|stipends?|fellowships?|scholarships?|atelierstipendi)\b/i

const IS_RETROSPECTIVE =
  /\b(gewinner|preisträger|preistraeger|ausgezeichnet|verliehen|wurde vergeben|winners?\b|awarded|has been awarded|rückblick|nachbericht|bilanz|explored|reflected on|their experiences?)\b/i

const IS_ROUNDUP =
  /\b(newsletter|round-?up|rückblick|monatsüberblick|im blick|überblick|in eigener sache)\b/i

const IS_JOB_AD =
  /\b(stelle|stellenangebot|stellenausschreibung|vollzeit|teilzeit|\(w\/m\/d\)|\(m\/w\/d\)|m\/w\/d|w\/m\/d|vacancy|job vacancy|wir suchen|bewerbungsfrist für die stelle|praktik|praktikant|aushilfe|trainee)\b/i

/**
 * H-Net tags every announcement with a curated "Subject Fields" list. That
 * taxonomy is a far better signal than the prose around it, so when it is
 * present the decision rests on it alone.
 */
function subjectFields(text) {
  // H-Net entries follow one of two formats for the taxonomy line:
  //   "Subject Fields: Architecture, Teaching and Learning, ..."
  //   "Subject Fields Architecture and Architectural History, ..."
  // Both must match. The colon is optional; the fields always start after "Fields"
  // with a space or colon + space.
  const match = text.match(
    /Subject Fields?\s*:?\s+([\s\S]{5,300}?)(?:\s+(?:Session Call|STRAND CALL|Call for|Contact|Date|Announcement)|\s*$)/i,
  )
  return match?.[1]?.trim() ?? ''
}

/**
 * Titles alone are too thin: "Dispozitiv Journal" and "Eje 4: Maintain, Continue
 * and Repair" name no subject at all, so the abstract has to carry the decision.
 */
function isRelevant(title, abstract = '') {
  const fields = subjectFields(abstract)

  if (fields) {
    // A declared taxonomy is authoritative: an off-topic field disqualifies the
    // call even when the abstract elsewhere mentions history or collections.
    if (OFF_TOPIC_FIELDS.test(fields)) return false
    return TOPIC_PATTERN.test(fields) || TOPIC_PATTERN.test(title)
  }

  return TOPIC_PATTERN.test(`${title} ${abstract}`)
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/xml, text/xml, text/html' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)

  // Kulturmanagement serves windows-1252 and says so in the XML declaration only;
  // decoding as UTF-8 turns every umlaut into a replacement character.
  const buffer = Buffer.from(await response.arrayBuffer())
  const declared = buffer.subarray(0, 200).toString('latin1').match(/encoding="([^"]+)"/i)?.[1]
  const charset = declared ?? response.headers.get('content-type')?.match(/charset=([^;]+)/i)?.[1]
  const encoding = /1252|latin1|iso-8859-1/i.test(charset ?? '') ? 'latin1' : 'utf8'
  return buffer.toString(encoding)
}

function decodeEntities(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    // German sources spell umlauts as named entities; without these the digest
    // shows "F&ouml;rderstipendien" verbatim.
    .replace(/&([aouAOU])uml;/g, (_, v) => ({ a: 'ä', o: 'ö', u: 'ü', A: 'Ä', O: 'Ö', U: 'Ü' })[v])
    .replace(/&szlig;/g, 'ß')
    .replace(/&([eaiou])acute;/gi, (_, v) => ({ e: 'é', a: 'á', i: 'í', o: 'ó', u: 'ú' })[v.toLowerCase()])
    .replace(/&(ndash|mdash);/g, '–')
    .replace(/&(lsquo|rsquo);/g, "'")
    .replace(/&(ldquo|rdquo);/g, '"')
    .replace(/&copy;/g, '©')
    .replace(/&(bull|middot);/g, '·')
    .replace(/&hellip;/g, '…')
    .replace(/&amp;/g, '&')
}

/** CDATA is unwrapped before tags are stripped: `<![CDATA[…]]>` itself matches the tag pattern. */
function stripTags(value) {
  const unwrapped = value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  return decodeEntities(unwrapped.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * A teaser for the digest: the opening of the call with the title removed, since
 * the digest already shows it directly above.
 */
function summarise(abstract, title) {
  // "Vorlesen lassen" is Köln's read-aloud button, not part of the call.
  const cleaned = abstract.replace(/\bVorlesen lassen\b/g, '').replace(/\s+/g, ' ').trim()
  // The headline can lead the body more than once — Köln renders it as both a
  // breadcrumb and a heading — so strip it repeatedly rather than once.
  let withoutTitle = cleaned
  if (title) {
    const lead = title.slice(0, 18).toLowerCase()
    for (let i = 0; i < 3; i++) {
      const trimmedStart = withoutTitle.replace(/^[\s:–—-]+/, '')
      if (!trimmedStart.toLowerCase().startsWith(lead)) break
      withoutTitle = trimmedStart.slice(title.length)
    }
  }
  const trimmed = withoutTitle.replace(/^[\s:–—-]+/, '').trim()

  // Cut on a sentence boundary so the teaser does not end mid-word.
  const clipped = trimmed.slice(0, 400)
  const lastStop = clipped.lastIndexOf('. ')
  return lastStop > 150 ? clipped.slice(0, lastStop + 1) : clipped
}

/**
 * Pulls the abstract off an announcement page.
 *
 * Both arthist.net and H-Net render the call as plain prose with no consistent
 * content wrapper, so the page is flattened and the boilerplate navigation
 * trimmed off the front rather than selected by container.
 */
async function fetchAbstract(url, marker) {
  const html = await fetchText(url)
  const text = stripTags(
    html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, ''),
  )

  // Skip the masthead: the call itself starts at the second mention of its title.
  const start = marker ? text.indexOf(marker, 200) : -1
  const body = start === -1 ? text : text.slice(start)

  return {
    abstract: body.slice(0, 1200),
    // German announcement pages state the submission deadline in words; it is
    // more useful in the digest than the date we happened to harvest on.
    deadline:
      body.match(/(?:Eingabeschluss|Einsendeschluss|Bewerbungsschluss|Deadline)\s*:?\s*([0-9]{1,2}\.[0-9]{1,2}\.[0-9]{4})/i)?.[1] ?? '',
  }
}

function tag(block, name) {
  const match = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'))
  return match ? stripTags(match[1]) : ''
}

function toIsoDate(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
}

const MONTHS_DE = [
  'januar', 'februar', 'märz', 'april', 'mai', 'juni',
  'juli', 'august', 'september', 'oktober', 'november', 'dezember',
]

/** "31. August 2026" and "31.08.2026" both become "31.08.2026". */
function normaliseGermanDate(value) {
  const named = value.match(/^(\d{1,2})\.\s*([A-Za-zäöüÄÖÜ]+)\s*(\d{4})$/)
  if (named) {
    const month = MONTHS_DE.indexOf(named[2].toLowerCase()) + 1
    if (!month) return ''
    return `${named[1].padStart(2, '0')}.${String(month).padStart(2, '0')}.${named[3]}`
  }

  const numeric = value.match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/)
  if (!numeric) return ''
  return `${numeric[1].padStart(2, '0')}.${numeric[2].padStart(2, '0')}.${numeric[3]}`
}

/** A URL identifies a call across runs; the hash keeps it short and filename-safe. */
function idFor(url) {
  let hash = 0
  for (let i = 0; i < url.length; i++) hash = (Math.imul(31, hash) + url.charCodeAt(i)) | 0
  return (hash >>> 0).toString(36)
}

/** Splits an RSS/Atom document into items without a DOM. */
function items(xml, element) {
  return xml.match(new RegExp(`<${element}[\\s>][\\s\\S]*?</${element}>`, 'gi')) ?? []
}

/**
 * Fetches each call's abstract and keeps only those in Ann-Kathrin's fields.
 *
 * One extra request per candidate, spaced out: arthist.net asks for a 10s
 * crawl-delay and H-Net for 5s, and this is a nightly job with no deadline, so
 * it waits rather than hurrying. Candidates are already few — a dozen or so per
 * run — because the CFP filter runs first.
 */
async function withAbstracts(calls) {
  const kept = []

  for (const call of calls) {
    try {
      await sleep(CRAWL_DELAY)
      const { abstract, deadline } = await fetchAbstract(call.url, call.title.slice(0, 30))
      if (IS_PAPER_CALL.test(`${call.title} ${abstract}`)) continue
      if (IS_STIPEND.test(call.title)) continue
      if (!isRelevant(call.title, abstract)) continue

      kept.push({
        ...call,
        description: summarise(abstract, call.title),
        deadline,
      })
    } catch (error) {
      // A detail page that will not load should not silently drop a call that
      // the title already shows to be relevant.
      console.error(`    detail failed for ${call.url}: ${error.message}`)
      if (!IS_STIPEND.test(call.title) && isRelevant(call.title)) kept.push(call)
    }
  }

  return kept
}

/**
 * Reads a plain RSS or Atom feed whose items already carry a usable teaser.
 *
 * Sources handled here publish calls alongside ordinary news, so both the title
 * and the teaser are searched, and no detail page is fetched: the teaser is
 * enough to judge relevance and one request per source keeps us light.
 */
function feedScraper(url) {
  return async () => {
    const xml = await fetchText(url)

    return items(xml, 'item')
      .concat(items(xml, 'entry'))
      .map((item) => ({
        title: tag(item, 'title'),
        url: tag(item, 'link') || item.match(/<link[^>]*href="([^"]+)"/i)?.[1] || '',
        date: toIsoDate(tag(item, 'pubDate') || tag(item, 'published') || tag(item, 'updated')),
        description: tag(item, 'description').slice(0, 400),
      }))
      .map((item) => ({
        ...item,
        // Job and call teasers print the closing date inline.
        deadline: normaliseGermanDate(
          item.description.match(
            /(?:Bewerbungsende|Bewerbungsschluss|Bewerbungsfrist|Einsendeschluss|Frist)\s*:?\s*(\d{1,2}\.\s*(?:\d{1,2}\.|[A-Za-zäöü]+)\s*\d{4})/i,
          )?.[1] ?? '',
        ),
      }))
      .filter((item) => item.url && CFP_PATTERN.test(`${item.title} ${item.description}`))
      .filter((item) => !IS_PAPER_CALL.test(`${item.title} ${item.description}`))
      .filter((item) => !IS_JOB_AD.test(`${item.title} ${item.description}`))
      .filter((item) => !IS_RETROSPECTIVE.test(`${item.title} ${item.description}`))
      .filter((item) => isRelevant(item.title, item.description))
  }
}

/**
 * H-Soz-Kult: rolling feed of academic job postings. The /searching/rss
 * endpoint ignores query parameters, so we read every Job entry and check
 * the employer and description against Ann-Kathrin's fields.
 *
 * Summary format: "Ort, Zeitraum, Arbeitgeber, Bewerbungsschluss: DD.MM.JJJJ"
 * — the Bewerbungsschluss is the deadline, the employer is the institution.
 */
async function scrapeHSozKult() {
  const xml = await fetchText('https://www.hsozkult.de/searching/rss')

  return items(xml, 'entry')
    .filter((item) => /^Job:/i.test(tag(item, 'title')))
    .map((item) => {
      const title = tag(item, 'title').replace(/^Job:\s*/i, '')
      const summary = tag(item, 'summary')
      const url = tag(item, 'link') || item.match(/<link[^>]*href="([^"]+)"/i)?.[1] || ''
      const deadlineMatch = summary.match(
        /Bewerbungsschluss:\s*(\d{1,2}\.\d{1,2}\.\d{4})/,
      )
      return {
        title,
        url,
        date: toIsoDate(tag(item, 'updated')),
        deadline: deadlineMatch ? normaliseGermanDate(deadlineMatch[1]) : '',
        description: summary.slice(0, 400),
      }
    })
    .filter((item) => !/praktik|aushilfe|trainee/i.test(item.title))
    .filter((item) => isRelevant(item.title, item.description))
}

/**
 * Kultur Management Network publishes calls for its magazine in the same feed as
 * its articles, so the title has to carry the filter.
 */
async function scrapeKulturmanagement() {
  const xml = await fetchText('https://www.kulturmanagement.net/Themen/rss')

  return items(xml, 'item')
    .map((item) => ({
      title: tag(item, 'title'),
      url: tag(item, 'link'),
      date: toIsoDate(tag(item, 'pubDate')),
      description: tag(item, 'description').slice(0, 400),
    }))
    .filter((item) => item.url && CFP_PATTERN.test(item.title))
    .filter((item) => !IS_PAPER_CALL.test(`${item.title} ${item.description}`))
    .filter((item) => !IS_RETROSPECTIVE.test(`${item.title} ${item.description}`))
    .filter((item) => isRelevant(item.title, item.description))
}

/**
 * Stadt Köln's official press feed. Cultural funding rounds are announced here
 * alongside everything else the city publishes, so both title and teaser are
 * searched — the deadline often sits only in the teaser.
 */
async function scrapeStadtKoeln() {
  const xml = await fetchText('https://www.stadt-koeln.de/externe-dienste/rss/pressemeldungen.xml')

  return items(xml, 'item')
    .map((item) => ({
      title: tag(item, 'title'),
      url: tag(item, 'link'),
      date: toIsoDate(tag(item, 'pubDate')),
      description: tag(item, 'description').slice(0, 400),
    }))
    .filter((item) => item.url && CFP_PATTERN.test(`${item.title} ${item.description}`))
    .filter((item) => !IS_PAPER_CALL.test(`${item.title} ${item.description}`))
    .filter((item) => !IS_RETROSPECTIVE.test(`${item.title} ${item.description}`))
    .filter((item) => isRelevant(item.title, item.description))
}

/**
 * H-Net's announcement channel, which carries the calls its lists circulate —
 * H-Soz-Kult among them. Read here rather than from hsozkult.de because this
 * host permits automated access and that one refuses it.
 *
 * No feed is offered, so the listing markup is parsed. Announcement links follow
 * /group/announcements/<id>/<slug>, which is stable enough to key on.
 */
async function scrapeHNet() {
  const html = await fetchText('https://networks.h-net.org/h-announce')

  const seen = new Set()
  const results = []

  for (const block of html.match(/<h3 class="content-item__header-title">[\s\S]*?<\/h3>/g) ?? []) {
    const url = block.match(/href="([^"]+)"/)?.[1] ?? ''
    const title = stripTags(block.replace(/<h3[^>]*>|<\/h3>/g, ''))
    if (!url || seen.has(url)) continue
    seen.add(url)
    results.push({ title, url, date: '', description: '' })
  }

  return withAbstracts(
    results.filter((item) => CFP_PATTERN.test(item.title) && !IS_PAPER_CALL.test(item.title)),
  )
}

/**
 * Stadt Köln's Kulturförderung index, which lists the city's open calls as
 * ordinary pages — no feed, and the press feed carries them only occasionally.
 *
 * Each linked page is read for its deadline and teaser; where the conditions
 * hang off an attached PDF, the URL is recorded so `enrichFromPdfs` can read it.
 */
async function scrapeKoelnFoerderung() {
  const index = 'https://www.stadt-koeln.de/leben-in-koeln/kultur/kulturfoerderung'
  const html = await fetchText(index)

  const slugs = [
    ...new Set(
      [...html.matchAll(/href="(\/leben-in-koeln\/kultur\/kulturfoerderung\/[^"#?]+)"/g)].map((m) => m[1]),
    ),
  ].filter((p) => /ausschreib|stipendi|preis|residen|wettbewerb|foerderstipendien/i.test(p))

  const calls = []

  for (const slug of slugs.slice(0, 12)) {
    try {
      await sleep(CRAWL_DELAY)
      const url = `https://www.stadt-koeln.de${slug}`
      const page = await fetchText(url)
      const text = stripTags(
        page.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, ''),
      )

      const title = stripTags(page.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '')
      if (!title) continue

      // The body repeats the masthead; start at the headline's second mention.
      const at = text.indexOf(title, 200)
      const body = (at === -1 ? text : text.slice(at)).slice(0, 1500)

      const deadline = body.match(
        /(?:Bewerbungsfrist|Bewerbungsschluss|Einsendeschluss|Frist)[^.]{0,40}?(\d{1,2}\.\s*(?:\d{1,2}\.|[A-Za-zäöü]+)\s*\d{4})/i,
      )?.[1]

      const pdf = page.match(/href="([^"]+\.pdf[^"]*)"/i)?.[1]

      calls.push({
        title,
        url,
        date: '',
        description: summarise(body, title),
        deadline: deadline ? normaliseGermanDate(deadline) : '',
        pdfUrl: pdf ? new URL(pdf, url).href : '',
      })
    } catch (error) {
      console.error(`    koeln page failed ${slug}: ${error.message}`)
    }
  }

  return calls
    .filter((c) => !IS_PAPER_CALL.test(`${c.title} ${c.description}`))
    .filter((c) => !IS_STIPEND.test(c.title))
    .filter((c) => !IS_RETROSPECTIVE.test(`${c.title} ${c.description}`))
    .filter((c) => isRelevant(c.title, c.description))
}

/**
 * Kultur Management Network's job board, filtered to work she could actually
 * take on: the feed states the engagement type in the title, so "freie
 * Mitarbeit" and "Honorar" are a structural signal rather than a keyword guess.
 * Permanent `Anstellung` posts are somebody else's job.
 */
async function scrapeRemoteWork() {
  const xml = await fetchText('https://www.kulturmanagement.net/Stellenmarkt/rss')

  return items(xml, 'item')
    .map((item) => {
      const raw = tag(item, 'title')
      return {
        // Titles read "Top - freie Mitarbeit - Ensemblemanager*in"; the leading
        // ranking and engagement labels are noise once they have been read.
        title: raw.replace(/^(Top\s*-\s*)?[^-]*-\s*/, '').trim() || raw,
        engagement: raw,
        url: tag(item, 'link'),
        date: toIsoDate(tag(item, 'pubDate')),
        description: tag(item, 'description').slice(0, 400),
      }
    })
    .filter((item) => item.url && IS_FREELANCE.test(item.engagement))
    .filter((item) => !/ensemble|orchester|chor|musik|ballett|tanz|concert|opern/i.test(item.title))
    .filter((item) => isRelevant(item.title, item.description))
    .map(({ engagement, ...item }) => ({ ...item, remote: true }))
}

/**
 * Stiftung EVZ — Erinnerung, Verantwortung und Zukunft. The major funder for
 * NS-remembrance work, and the closest thing to a client pool for Gedenkstätten
 * projects: its calls fund exactly the research-and-mediation work she does.
 *
 * The listing is a JavaScript-heavy page with no feed and no reliable markup
 * around each call — deadline, title and summary sit in a flat run of text. The
 * region is isolated deterministically and the model reads the fields out of it,
 * so nothing depends on a class name the CMS may rename next month.
 *
 * Falls back to nothing when AI_PROXY_URL is unset: the page yields no
 * structured call without it, which is better than a half-parsed one.
 */
async function scrapeEvz() {
  const aiProxyUrl = process.env.AI_PROXY_URL
  if (!aiProxyUrl) return []

  const pages = [
    'https://www.stiftung-evz.de/was-wir-foerdern/ausschreibungen-fuer-projekte/',
    'https://www.stiftung-evz.de/wer-wir-sind/oeffentliche-ausschreibungen/',
  ]

  const calls = []

  for (const url of pages) {
    try {
      await sleep(CRAWL_DELAY)
      const text = stripTags(
        (await fetchText(url))
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, ''),
      )

      // Everything before the listing heading is site chrome.
      const at = text.search(/Aktuelle (?:öffentliche )?Ausschreibungen/i)
      const body = (at === -1 ? text : text.slice(at)).slice(0, 12_000)
      if (body.length < 300) continue

      const extracted = await extractCall(body, { aiProxyUrl })
      if (!extracted?.title) continue

      calls.push({
        title: extracted.title,
        url,
        date: '',
        description: extracted.description,
        deadline: extracted.deadline,
        remote: extracted.remote,
      })
    } catch (error) {
      console.error(`    evz page failed ${url}: ${error.message}`)
    }
  }

  return calls
    .filter((c) => !IS_PAPER_CALL.test(`${c.title} ${c.description}`))
    .filter((c) => !IS_RETROSPECTIVE.test(`${c.title} ${c.description}`))
    .filter((c) => isRelevant(c.title, c.description))
}


/**
 * Museumsbund — German Museums Association. WP REST API carries DigAMus Award
 * and other calls. Deadline is in the title or content.
 */
async function scrapeMuseumsbund() {
  const res = await fetchText(
    'https://www.museumsbund.de/wp-json/wp/v2/posts?per_page=20&_fields=title,link,content',
  )
  let posts
  try { posts = JSON.parse(res) } catch { return [] }
  return posts
    .map((p) => {
      const title = stripTags(p.title?.rendered ?? '')
      const content = stripTags(p.content?.rendered ?? '')
      const blob = title + ' ' + content
      const dl = blob.match(/(?:Bewerbungsfrist|Einreichungen bis|bis zum|bis Ende)s*:?\s*(\d{1,2}\.\s*(?:\d{1,2}\.|[A-Za-zäöü]+)\s*\d{4})/i)
      return { title, url: p.link ?? '', date: p.date?.slice(0, 10) ?? '', description: content.slice(0, 400), deadline: dl ? normaliseGermanDate(dl[1]) : '' }
    })
    .filter((item) => item.url && item.deadline && isRelevant(item.title, item.description))
}

/**
 * Kulturstiftung des Bundes — federal cultural foundation. Projektförderung
 * page lists active calls with deadlines.
 */
async function scrapeKulturstiftungBund() {
  const text = stripTags(
    (await fetchText('https://www.kulturstiftung-des-bundes.de/de/foerder_check_antrag/aktuelle_antragsmoeglichkeiten.html'))
      .replace(/<script[sS]*?<\/script>/gi, '')
      .replace(/<style[sS]*?<\/style>/gi, ''),
  )
  const calls = []
  for (const section of text.split(/(?=Allgemeine Projektförderung|Programmförderung)/i)) {
    const dl = section.match(/(?:Bewerbungsfrist|Frist|Antragsfrist)s*:?\s*(\d{1,2}\.\s*(?:\d{1,2}\.|[A-Za-zäöü]+)\s*\d{4})/i)
    if (!dl) continue
    calls.push({ title: 'Kulturstiftung des Bundes – aktuelle Antragsmöglichkeit', url: 'https://www.kulturstiftung-des-bundes.de/de/foerder_check_antrag/aktuelle_antragsmoeglichkeiten.html', date: '', description: section.slice(0, 400), deadline: normaliseGermanDate(dl[1]) })
  }
  return calls.filter((c) => isRelevant(c.title, c.description))
}

/**
 * Secession Wien — the Austrian art society. Publishes the Gmoser-Preis
 * für Gegenwartskunst as a dated call on a fixed URL pattern:
 *   secession.at/ausschreibung_gmoser-preis_<year>
 *
 * The page body contains "bis DD. Monat YYYY" as the deadline. No feed,
 * no API — just the annual page.
 */
async function scrapeSecession() {
  const year = new Date().getFullYear()
  const url = `https://secession.at/ausschreibung_gmoser-preis_${year}`
  const text = stripTags(
    (await fetchText(url))
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, ''),
  )

  const dl = text.match(/bis\s+(\d{1,2})\.\s*([A-Za-zäöü]+)\s*(\d{4})/)
  if (!dl) return []

  const months = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']
  const monthNum = months.indexOf(dl[2]) + 1
  if (!monthNum) return []

  const deadline = `${dl[1].padStart(2,'0')}.${String(monthNum).padStart(2,'0')}.${dl[3]}`

  // Extract the title — it's the first heading or the first sentence.
  const titleMatch = text.match(/(?:Ausschreibung|Preis)[^.]{0,80}/i)
  const title = titleMatch ? titleMatch[0].slice(0, 100) : 'Gmoser-Preis für Gegenwartskunst'

  return [{
    title,
    url,
    date: '',
    description: text.slice(0, 400),
    deadline,
  }]
}
const SOURCES = {
  museumsbund: scrapeMuseumsbund,
  'kulturstiftung-bund': scrapeKulturstiftungBund,
  secession: scrapeSecession,
  'h-soz-kult': scrapeHSozKult,
  'h-net': scrapeHNet,
  icom: feedScraper('https://icom-deutschland.de/feed'),
  'royal-historical-society': feedScraper('https://royalhistsoc.org/feed/'),
  prohelvetia: feedScraper('https://prohelvetia.ch/de/feed/'),
  'stadt-koeln-foerderung': scrapeKoelnFoerderung,
  evz: scrapeEvz,
  'remote-work': scrapeRemoteWork,
  kulturmanagement: scrapeKulturmanagement,
  'stadt-koeln': scrapeStadtKoeln,
}

/**
 * Some calls state their conditions and deadline only in an attached PDF, which
 * no amount of feed parsing reaches. Where a detail page links one, the PDF is
 * read and structured through the AI proxy.
 *
 * Strictly an enrichment: it fills a missing deadline and sharpens the teaser on
 * a call the deterministic pass already found and judged relevant. It can never
 * add or remove an entry, so a proxy outage costs detail, never coverage — and
 * with AI_PROXY_URL unset the scraper behaves exactly as before.
 */
async function enrichFromPdfs(calls) {
  const aiProxyUrl = process.env.AI_PROXY_URL
  if (!aiProxyUrl) return calls

  for (const call of calls) {
    if (call.deadline || !call.pdfUrl) continue

    try {
      await sleep(CRAWL_DELAY)
      const { call: extracted } = await extractCallFromPdf(call.pdfUrl, { aiProxyUrl })
      if (!extracted) continue

      call.deadline = extracted.deadline || call.deadline
      call.description = extracted.description || call.description
      if (extracted.remote) call.remote = true
    } catch (error) {
      console.error(`    pdf enrich failed for ${call.pdfUrl}: ${error.message}`)
    }
  }

  return calls
}

const today = new Date().toISOString().slice(0, 10)
const existing = JSON.parse(await readFile(OUT, 'utf8').catch(() => '[]'))
const known = new Set(existing.map((cfp) => cfp.url))

const found = []
let failures = 0

// Sequential rather than parallel: a handful of requests a day needs no
// concurrency, and one source at a time keeps us inside every crawl-delay.
for (const [source, scrape] of Object.entries(SOURCES)) {
  try {
    const results = await enrichFromPdfs(await scrape())
    console.error(`  ${source}: ${results.length} matching`)

    for (const item of results) {
      if (known.has(item.url)) continue
      known.add(item.url)
      found.push({
        id: idFor(item.url),
        title: item.title,
        source,
        url: item.url,
        date: item.date || today,
        deadline: item.deadline ?? '',
        remote: item.remote === true,
        description: item.description,
        first_seen: today,
      })
    }
  } catch (error) {
    // One portal changing its markup must not cost the whole digest.
    failures++
    console.error(`  ${source}: FAILED — ${error.message}`)
  }
}

if (failures === Object.keys(SOURCES).length) {
  console.error('every source failed; leaving the file untouched')
  process.exit(1)
}

if (!process.argv.includes('--dry-run') && found.length) {
  const merged = [...found, ...existing].sort((a, b) => b.date.localeCompare(a.date))
  await writeFile(OUT, `${JSON.stringify(merged, null, 2)}\n`)
}

console.error(`${found.length} new, ${existing.length} known`)
process.stdout.write(JSON.stringify(found))
