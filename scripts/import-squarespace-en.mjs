/**
 * Imports the English articles Ann-Kathrin wrote herself on Squarespace
 * (`/journal-en/`), overwriting the machine translation of the same post.
 *
 * Her own wording always beats DeepL's, so these files are excluded from
 * `npm run translate` by the `--only-missing` flag once they exist. Run this
 * before a full re-translation if the English source ever changes.
 *
 *   node scripts/import-squarespace-en.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const SITE = 'https://rahlwes.eu'
const OUT_DIR = 'src/content/journal/en'
const UPLOAD_DIR = 'src/assets/uploads'

/**
 * Maps a Squarespace English slug onto the German slug it translates, so both
 * locales resolve at the same URL and the language switcher keeps working.
 */
const articles = [{ source: 'the-frankfurt-history-app', slug: 'orteerforschen' }]

function htmlToMarkdown(html) {
  const md = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<div class="sqs-video[\s\S]*?<\/div>/gi, '')
    .replace(/\sdata-[a-z-]+="[^"]*"/gi, '')
    .replace(/\sclass="[^"]*"/gi, '')
    .replace(/\sstyle="[^"]*"/gi, '')
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, text) => `\n\n${'#'.repeat(Number(level))} ${text.trim()}\n\n`)
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
    .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**')
    .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*')
    .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*')
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1')
    .replace(/<\/?(ul|ol)[^>]*>/gi, '\n')
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, text) => `\n> ${text.trim()}\n`)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<img[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*>/gi, '\n![$1]($2)\n')
    .replace(/<[^>]+>/g, '')

  return md
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Keeps the description under ~160 chars without truncating mid-word. */
function clampDescription(text) {
  const clean = text.trim().replace(/\s+/g, ' ')
  if (clean.length <= 160) return clean
  const cut = clean.slice(0, 160)
  const boundary = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
  return boundary > 80 ? cut.slice(0, boundary + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}…`
}

async function downloadImage(url, slug) {
  if (!url) return null
  const clean = url.split('?')[0]
  const extension = clean.match(/\.(jpe?g|png|webp|gif|avif)$/i)?.[1] ?? 'jpg'
  const filename = `${slug}-en.${extension.toLowerCase()}`
  const response = await fetch(`${clean}?format=1500w`)
  if (!response.ok) {
    console.warn(`  ! cover download failed (${response.status})`)
    return null
  }
  const target = join(UPLOAD_DIR, filename)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, Buffer.from(await response.arrayBuffer()))
  return `/uploads/${filename}`
}

for (const { source, slug } of articles) {
  const response = await fetch(`${SITE}/journal-en/${source}?format=json`)
  if (!response.ok) {
    console.warn(`! skipping ${source}: HTTP ${response.status}`)
    continue
  }
  const payload = await response.json()
  const item = payload.item ?? payload.items?.[0]
  if (!item) {
    console.warn(`! skipping ${source}: no item in payload`)
    continue
  }

  const publishedAt = new Date(item.publishOn).toISOString().slice(0, 10)
  const excerpt = htmlToMarkdown(item.excerpt ?? '').replace(/\n+/g, ' ').trim()
  const cover = await downloadImage(item.assetUrl, slug)
  const body = htmlToMarkdown(item.body ?? '')
  const seo = item.seoData ?? {}

  const frontmatter = [
    '---',
    `title: ${JSON.stringify(item.title)}`,
    `publishedAt: ${publishedAt}`,
    'draft: false',
    `excerpt: ${JSON.stringify(excerpt)}`,
    `coverImage: ${cover ? JSON.stringify(cover) : 'null'}`,
    `coverAlt: ${JSON.stringify(item.title)}`,
    // Marks this file as hers, so scripts/translate.mjs never overwrites it.
    'translated: false',
    'seo:',
    `  title: ${JSON.stringify(seo.seoTitle ?? item.title)}`,
    // Trim on a sentence boundary; a hard slice cut her description mid-word.
    `  description: ${JSON.stringify(clampDescription(seo.seoDescription ?? excerpt))}`,
    '---',
    '',
  ].join('\n')

  const target = join(OUT_DIR, `${slug}.mdx`)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, `${frontmatter}${body}\n`)
  console.log(`✓ ${target} (from /journal-en/${source})${cover ? ` + ${cover}` : ''}`)
}
