/**
 * Translates the German content tree into English and French via our DeepLX worker.
 *
 * German is the single source of truth: every run overwrites the target files
 * unless `--only-missing` is passed. Markdown structure survives because we
 * translate block by block and never send fences, front matter keys or URLs.
 *
 *   node scripts/translate.mjs                  # all locales, all files
 *   node scripts/translate.mjs --only-missing   # skip files that already exist
 *   node scripts/translate.mjs --locale fr      # one target locale
 *   node scripts/translate.mjs --file src/content/journal/de/foo.mdx
 */
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

const ENDPOINT = process.env.DEEPLX_URL ?? 'https://translate.jonas-strassel.de'
const TOKEN = process.env.DEEPLX_TOKEN
if (!TOKEN) {
  console.error('DEEPLX_TOKEN is not set. Export it or run via `npm run translate` which loads .env.')
  process.exit(1)
}

const SOURCE_LOCALE = 'de'
const TARGETS = { en: 'EN', fr: 'FR' }
const ROOTS = ['src/content/journal', 'src/content/projects', 'src/content/pages', 'src/content/home']

/** Long articles are hundreds of blocks; serial requests take minutes per file.
 *  Above ~4 in flight the worker starts answering 503. */
const CONCURRENCY = 4

const args = process.argv.slice(2)
const onlyMissing = args.includes('--only-missing')
const localeFilter = args.includes('--locale') ? args[args.indexOf('--locale') + 1] : null
const fileFilter = args.includes('--file') ? args[args.indexOf('--file') + 1] : null

/** Front matter keys holding prose. Everything else (dates, slugs, paths) is copied verbatim. */
const TRANSLATABLE_KEYS = new Set([
  'title',
  'excerpt',
  'intro',
  'coverAlt',
  'description',
  'text',
  'heroHeading',
  'heroText',
  'heroCta',
  'heroImageAlt',
  'servicesHeading',
  'aboutHeading',
  'quote',
  // A person's name must never be translated, but the role attached to it should be.
  'role',
])

const cache = new Map()

async function translateText(text, targetLang) {
  const trimmed = text.trim()
  if (!trimmed) return text

  const cacheKey = `${targetLang}:${trimmed}`
  const cached = cache.get(cacheKey)
  if (cached) return applyPadding(text, await cached)

  const pending = (async () => {
    // 503 means the worker is shedding load, so back off long enough to matter.
    for (let attempt = 1; attempt <= 6; attempt++) {
      const response = await fetch(`${ENDPOINT}/translate`, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ text: trimmed, source_lang: 'DE', target_lang: targetLang }),
      })
      const payload = await response.json().catch(() => ({}))
      if (payload.code === 200 && payload.data) return payload.data

      if (attempt === 6) {
        throw new Error(`DeepL failed (${payload.code ?? response.status}) for: ${trimmed.slice(0, 80)}`)
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** (attempt - 1)))
    }
  })()

  cache.set(cacheKey, pending)
  return applyPadding(text, await pending)
}

/** Restores the leading/trailing whitespace DeepL strips from the block. */
function applyPadding(original, translated) {
  const [, lead = '', , trail = ''] = original.match(/^(\s*)([\s\S]*?)(\s*)$/) ?? []
  return `${lead}${translated}${trail}`
}

async function mapPool(items, worker) {
  const results = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

/**
 * Splits markdown into translatable prose and untouchable structure. Code fences,
 * images and reference links must survive byte-identical or the page breaks.
 */
async function translateMarkdown(markdown, targetLang) {
  const segments = markdown.split(/(```[\s\S]*?```|^!\[[^\]]*\]\([^)]*\)$)/gm)

  // Flatten every prose block across all segments so one pool covers the file.
  const jobs = []
  const shape = segments.map((segment) => {
    if (!segment || segment.startsWith('```') || /^!\[/.test(segment)) return { literal: segment }
    const blocks = segment.split(/\n{2,}/).map((block) => {
      if (!block.trim()) return { literal: block }
      const marker = block.match(/^(\s*(?:[-*+]|\d+\.|>|#{1,6})\s+)/)
      const prefix = marker?.[1] ?? ''
      const jobIndex = jobs.length
      jobs.push({ text: block.slice(prefix.length) })
      return { prefix, jobIndex }
    })
    return { blocks }
  })

  const translations = await mapPool(jobs, (job) => translateText(job.text, targetLang))

  return shape
    .map((part) => {
      if ('literal' in part) return part.literal
      return part.blocks
        .map((block) => ('literal' in block ? block.literal : block.prefix + translations[block.jobIndex].trim()))
        .join('\n\n')
    })
    .join('')
}

/** Collects every translatable string in a JSON tree, translates in one pool, then rebuilds. */
async function translateJson(value, targetLang) {
  const jobs = []
  const collect = (node, key = '') => {
    if (typeof node === 'string') {
      if (!TRANSLATABLE_KEYS.has(key)) return node
      const jobIndex = jobs.length
      jobs.push(node)
      return { __job: jobIndex }
    }
    if (Array.isArray(node)) return node.map((item) => collect(item, key))
    if (node && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, collect(v, k)]))
    }
    return node
  }

  const skeleton = collect(value)
  const translations = await mapPool(jobs, (text) => translateText(text, targetLang))

  const rebuild = (node) => {
    if (node && typeof node === 'object' && '__job' in node) return translations[node.__job].trim()
    if (Array.isArray(node)) return node.map(rebuild)
    if (node && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, rebuild(v)]))
    }
    return node
  }

  return rebuild(skeleton)
}

/** Minimal front-matter split: MDX front matter is always the first `---` block. */
function splitFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return { frontmatter: null, body: raw }
  return { frontmatter: match[1], body: match[2] }
}

/**
 * Translates YAML line by line. The importer writes flat JSON-scalar values, so a
 * full YAML parser would add a dependency without buying correctness here.
 */
async function translateFrontmatter(frontmatter, targetLang) {
  const lines = frontmatter.split('\n')

  const jobs = []
  const shape = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const match = line.match(/^(\s*)([A-Za-z0-9_]+):\s*(.*)$/)
    if (!match) {
      shape.push({ literal: line })
      continue
    }

    const [, indent, key, value] = match
    if (!TRANSLATABLE_KEYS.has(key) || value === 'null') {
      shape.push({ literal: line })
      continue
    }

    // Block scalars (`key: >-`) hold their text on the following indented lines.
    // Collect the whole block, translate it as one string, and re-emit it as a
    // quoted scalar — earlier versions skipped these, which silently left long
    // `intro` and `description` fields untranslated.
    if (/^[>|][-+]?\d*$/.test(value.trim())) {
      const body = []
      let j = i + 1
      while (j < lines.length) {
        const next = lines[j]
        if (next.trim() && !next.startsWith(indent + ' ')) break
        body.push(next.trim())
        j++
      }
      const text = body.join(' ').trim()
      if (!text) {
        shape.push({ literal: line })
        continue
      }
      shape.push({ indent, key, jobIndex: jobs.length })
      jobs.push(text)
      i = j - 1
      continue
    }

    if (!value) {
      shape.push({ literal: line })
      continue
    }

    const isQuoted = /^".*"$/.test(value)
    shape.push({ indent, key, jobIndex: jobs.length })
    jobs.push(isQuoted ? JSON.parse(value) : value)
  }

  const translations = await mapPool(jobs, (text) => translateText(text, targetLang))

  return shape
    .map((part) =>
      'literal' in part ? part.literal : `${part.indent}${part.key}: ${JSON.stringify(translations[part.jobIndex].trim())}`,
    )
    .join('\n')
}

/**
 * True when the target file is human-written rather than generated. Marked with
 * `translated: false` in front matter (or `"translated": false` in JSON), which
 * `scripts/import-squarespace-en.mjs` writes for her own English articles.
 */
async function isAuthored(path) {
  const raw = await readFile(path, 'utf8').catch(() => null)
  if (!raw) return false
  return /^\s*"?translated"?:\s*false\s*,?\s*$/m.test(raw)
}

async function collectSourceFiles() {
  const files = []
  for (const root of ROOTS) {
    const sourceDir = join(root, SOURCE_LOCALE)
    if (!(await stat(sourceDir).catch(() => null))) continue
    for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
      if (entry.isFile()) files.push(join(sourceDir, entry.name))
    }
  }
  return files
}

const sourceFiles = fileFilter ? [fileFilter] : await collectSourceFiles()
const targets = localeFilter ? { [localeFilter]: TARGETS[localeFilter] } : TARGETS

let failures = 0

for (const [locale, deeplCode] of Object.entries(targets)) {
  if (!deeplCode) {
    console.error(`Unknown target locale: ${locale}`)
    process.exit(1)
  }

  for (const sourcePath of sourceFiles) {
    const targetPath = sourcePath.replace(`/${SOURCE_LOCALE}/`, `/${locale}/`)
    if (onlyMissing && (await stat(targetPath).catch(() => null))) {
      console.log(`· skip ${relative('.', targetPath)} (exists)`)
      continue
    }

    // Some locales have copy Ann-Kathrin wrote herself rather than a translation.
    // Machine output must never replace it, so those files opt out permanently.
    if (await isAuthored(targetPath)) {
      console.log(`· keep ${relative('.', targetPath)} (authored, not a translation)`)
      continue
    }

    const raw = await readFile(sourcePath, 'utf8')
    await mkdir(dirname(targetPath), { recursive: true })

    // One unlucky file must not discard the other twenty; report and continue.
    try {
      if (sourcePath.endsWith('.json')) {
        const translated = await translateJson(JSON.parse(raw), deeplCode)
        await writeFile(targetPath, `${JSON.stringify(translated, null, 2)}\n`)
      } else {
        const { frontmatter, body } = splitFrontmatter(raw)
        const [translatedFrontmatter, translatedBody] = await Promise.all([
          frontmatter ? translateFrontmatter(frontmatter, deeplCode) : null,
          translateMarkdown(body, deeplCode),
        ])
        const output = translatedFrontmatter
          ? `---\n${translatedFrontmatter}\n---\n\n${translatedBody.trim()}\n`
          : `${translatedBody.trim()}\n`
        await writeFile(targetPath, output)
      }
      console.log(`✓ ${relative('.', targetPath)}`)
    } catch (error) {
      failures++
      console.error(`✗ ${relative('.', targetPath)}: ${error.message}`)
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} file(s) failed. Re-run with --only-missing to retry just those.`)
  process.exit(1)
}
