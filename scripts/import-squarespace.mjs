/**
 * One-off import of the Squarespace journal into Keystatic-shaped MDX.
 *
 * Squarespace exposes every collection as JSON via `?format=json`, which keeps
 * the body HTML intact — far more reliable than scraping the rendered page.
 * Run once: `node scripts/import-squarespace.mjs`
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const SITE = 'https://rahlwes.eu'
const OUT_DIR = 'src/content/journal/de'
const UPLOAD_DIR = 'public/uploads'

const slugs = [
  'google-arts-and-culture',
  'schwieriges-erbe',
  'gab-es-zwangsarbeit-whrend-des-nationalsozialismus-in-frankfurt',
  'digitale-spiele',
  'orteerforschen',
  'familienerforschen',
]

/** Squarespace wraps everything in presentational markup; keep only semantics. */
function htmlToMarkdown(html) {
  let md = html
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

async function downloadImage(url, slug) {
  if (!url) return null
  const clean = url.split('?')[0]
  const extension = clean.match(/\.(jpe?g|png|webp|gif|avif)$/i)?.[1] ?? 'jpg'
  const filename = `${slug}.${extension.toLowerCase()}`
  const response = await fetch(`${clean}?format=1500w`)
  if (!response.ok) {
    console.warn(`  ! cover download failed (${response.status}) for ${slug}`)
    return null
  }
  const target = join(UPLOAD_DIR, filename)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, Buffer.from(await response.arrayBuffer()))
  return `/uploads/${filename}`
}

for (const slug of slugs) {
  const response = await fetch(`${SITE}/journal/${slug}?format=json`)
  if (!response.ok) {
    console.warn(`! skipping ${slug}: HTTP ${response.status}`)
    continue
  }
  const payload = await response.json()
  const item = payload.item ?? payload.items?.[0]
  if (!item) {
    console.warn(`! skipping ${slug}: no item in payload`)
    continue
  }

  const publishedAt = new Date(item.publishOn).toISOString().slice(0, 10)
  const excerpt = htmlToMarkdown(item.excerpt ?? '').replace(/\n+/g, ' ').trim()
  const cover = await downloadImage(item.assetUrl, slug)
  const body = htmlToMarkdown(item.body ?? '')

  const frontmatter = [
    '---',
    `title: ${JSON.stringify(item.title)}`,
    `publishedAt: ${publishedAt}`,
    'draft: false',
    `excerpt: ${JSON.stringify(excerpt)}`,
    `coverImage: ${cover ? JSON.stringify(cover) : 'null'}`,
    `coverAlt: ${JSON.stringify(item.title)}`,
    'seo:',
    `  title: ${JSON.stringify(item.seoData?.seoTitle ?? item.title)}`,
    `  description: ${JSON.stringify(item.seoData?.seoDescription ?? excerpt.slice(0, 160))}`,
    '---',
    '',
  ].join('\n')

  const target = join(OUT_DIR, `${slug}.mdx`)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, `${frontmatter}${body}\n`)
  console.log(`✓ ${target}${cover ? ` (+ ${cover})` : ''}`)
}
