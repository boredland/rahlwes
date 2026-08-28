/**
 * Imports the remaining German pages from the live Squarespace site into the
 * `projects` and `pages` collections.
 *
 * These are layout pages: the JSON API returns only chrome for them, so the
 * markup has to come from the rendered HTML. Squarespace nests each block in
 * several wrapper divs, so this walks `.sqs-html-content` regions rather than
 * trying to match tags across the whole document.
 *
 *   node scripts/import-squarespace-pages.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const SITE = 'https://rahlwes.eu'
const UPLOAD_DIR = 'src/assets/uploads'

/**
 * `order` continues the three project entries that already exist, so the
 * reference pages sort after the service overview they belong to.
 */
const pages = [
  {
    source: 'ausstellung-forschung',
    collection: 'projects',
    slug: 'ausstellung-und-forschung',
    category: 'ausstellung',
    order: 4,
  },
  { source: 'nal', collection: 'projects', slug: 'notaufnahmelager-giessen', category: 'ausstellung', order: 5 },
  { source: 'familie-frank', collection: 'projects', slug: 'wir-sind-jetzt', category: 'ausstellung', order: 6 },
  { source: 'nachgefragt', collection: 'projects', slug: 'nachgefragt', category: 'ausstellung', order: 7 },
  {
    source: 'provenienzforschung',
    collection: 'projects',
    slug: 'geerbt-gekauft-geraubt',
    category: 'ausstellung',
    order: 8,
  },
  {
    source: 'digitales-storytelling',
    collection: 'projects',
    slug: 'digitales-storytelling',
    category: 'digital',
    order: 9,
  },
  {
    source: 'unterrichtsmaterial',
    collection: 'projects',
    slug: 'unterrichtsmaterial',
    category: 'material',
    order: 10,
  },
  { source: 'museen', collection: 'pages', slug: 'fuer-museen' },
  { source: 'impressum', collection: 'pages', slug: 'impressum' },
  { source: 'datenschutz', collection: 'pages', slug: 'datenschutz' },
]

/** Trims to a sentence boundary so cards and meta descriptions never cut mid-word. */
function clamp(text, max) {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max)
  const boundary = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
  return boundary > max * 0.5 ? cut.slice(0, boundary + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}…`
}

const decode = (s) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, '’')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')

function inlineToMarkdown(html) {
  return decode(
    html
      .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
      .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
      .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')
      .replace(/<br\s*\/?>/gi, ' ')
      // Squarespace ends blocks without whitespace, gluing sentences together.
      .replace(/<\/(p|div|h[1-6]|li)>/gi, ' ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\*\*\s*\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Squarespace emits every text block inside `.sqs-html-content`. Reading those
 * in document order reconstructs the page without the surrounding layout noise.
 */
/**
 * Squarespace emits every text block inside its own `.sqs-html-content` div and
 * images as separate blocks. Parsing each region independently avoids the
 * unclosed-<p> wrappers that otherwise swallow whole sections of the page.
 */
function extractBlocks(html) {
  const main = html.match(/<main[^>]*>([\s\S]*?)<\/main>/)?.[1] ?? html
  const cleaned = main.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, '')

  const blocks = []
  const seen = new Set()

  const push = (block, key) => {
    if (seen.has(key)) return
    seen.add(key)
    blocks.push(block)
  }

  // Regions and images, interleaved in document order.
  const region = /<div class="sqs-html-content"[^>]*>([\s\S]*?)<\/div>|<img\b([^>]*?)>/gi
  let match
  while ((match = region.exec(cleaned))) {
    const [, content, imgAttrs] = match

    if (imgAttrs) {
      const src = imgAttrs.match(/\sdata-src="([^"]+)"/)?.[1] ?? imgAttrs.match(/\ssrc="([^"]+)"/)?.[1]
      const alt = imgAttrs.match(/\salt="([^"]*)"/)?.[1] ?? ''
      if (src && !src.startsWith('data:')) push({ kind: 'img', src, alt: decode(alt) }, src)
      continue
    }

    const inner = /<(h[1-6])[^>]*>([\s\S]*?)<\/\1>|<p[^>]*>([\s\S]*?)<\/p>|<li[^>]*>([\s\S]*?)<\/li>/gi
    let node
    while ((node = inner.exec(content))) {
      const [, heading, headingText, paragraph, listItem] = node
      const text = inlineToMarkdown(heading ? headingText : (paragraph ?? listItem))
      if (!text) continue
      if (/^Folie \d/.test(text) || text === 'Ausstellungsprojekt') continue

      if (heading) push({ kind: 'heading', level: Number(heading[1]), text }, text)
      else if (listItem) push({ kind: 'li', text }, text)
      else push({ kind: 'p', text }, text)
    }
  }

  return blocks
}

async function downloadImage(url, name) {
  const clean = url.split('?')[0]
  const extension = clean.match(/\.(jpe?g|png|webp|gif|avif)$/i)?.[1]?.toLowerCase() ?? 'jpg'
  const filename = `${name}.${extension}`
  const response = await fetch(`${clean}?format=1500w`)
  if (!response.ok) return null
  const target = join(UPLOAD_DIR, filename)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, Buffer.from(await response.arrayBuffer()))
  return `/uploads/${filename}`
}

for (const page of pages) {
  const response = await fetch(`${SITE}/${page.source}`)
  if (!response.ok) {
    console.warn(`! ${page.source}: HTTP ${response.status}`)
    continue
  }
  const html = await response.text()
  const blocks = extractBlocks(html)

  const headings = blocks.filter((b) => b.kind === 'heading')
  // The first h1 is the page title; a lone "Ausstellungsprojekt" label is not.
  const titleBlock =
    headings.find((b) => b.level === 1 && !/^(Ausstellungsprojekt|Trailer)/.test(b.text)) ??
    headings.find((b) => !/^(Ausstellungsprojekt|Trailer)/.test(b.text)) ??
    headings[0]
  const title = (titleBlock?.text ?? page.slug).replace(/\*\*/g, '')

  const firstParagraph = blocks.find((b) => b.kind === 'p' && b.text.length > 60)
  // excerpt and seo.description render as plain text, so strip inline Markdown
  // rather than shipping literal ** and [] into card copy and meta tags.
  const excerpt =
    firstParagraph?.text
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1') ?? ''

  const images = blocks.filter((b) => b.kind === 'img')
  const cover = images[0] ? await downloadImage(images[0].src, page.slug) : null

  // Body: everything after the title, images inlined where they appeared.
  const startIndex = titleBlock ? blocks.indexOf(titleBlock) + 1 : 0
  const headingRanks = [
    ...new Set(blocks.slice(startIndex).filter((b) => b.kind === 'heading').map((b) => b.level)),
  ].sort((a, b) => a - b)
  const body = []
  for (const block of blocks.slice(startIndex)) {
    if (block.kind === 'heading') {
      // Squarespace authors pick heading levels visually, so a page can start at
      // h4 under the h1. Rebase them onto a contiguous scale from h2 — skipped
      // levels fail the heading-order accessibility check.
      const rank = headingRanks.indexOf(block.level)
      body.push(`\n${'#'.repeat(Math.min(6, 2 + rank))} ${block.text.replace(/\*\*/g, '')}\n`)
    }
    else if (block.kind === 'li') body.push(`- ${block.text}`)
    else if (block.kind === 'p') body.push(`\n${block.text}\n`)
  }

  const frontmatter = [
    '---',
    `title: ${JSON.stringify(title)}`,
    ...(page.collection === 'projects'
      ? [`order: ${page.order}`, `category: ${JSON.stringify(page.category)}`]
      : []),
    page.collection === 'projects'
      ? `excerpt: ${JSON.stringify(clamp(excerpt, 260))}`
      : `intro: ${JSON.stringify(clamp(excerpt, 260))}`,
    ...(page.collection === 'projects'
      ? [`coverImage: ${cover ? JSON.stringify(cover) : 'null'}`, `coverAlt: ${JSON.stringify(images[0]?.alt ?? title)}`]
      : []),
    'seo:',
    `  title: ${JSON.stringify(title)}`,
    `  description: ${JSON.stringify(clamp(excerpt, 155))}`,
    '---',
    '',
  ].join('\n')

  const target = join('src/content', page.collection, 'de', `${page.slug}.mdx`)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, `${frontmatter}${body.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`)
  console.log(`✓ ${target}  (${body.length} blocks${cover ? ', +cover' : ''})`)
}
