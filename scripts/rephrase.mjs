/**
 * DeepL Write polish for German drafts — the step between "written in Gemini"
 * and "pasted into Keystatic".
 *
 *   node scripts/rephrase.mjs draft.md            # writes draft.rephrased.md
 *   node scripts/rephrase.mjs draft.md --in-place
 *   cat draft.md | node scripts/rephrase.mjs -    # stdout
 *
 * Every suggestion is printed as a diff so nothing is applied unread: DeepL Write
 * shifts register (it turns terse copy into flowing prose), which is wrong for
 * headings and captions.
 */
import { readFile, writeFile } from 'node:fs/promises'

const ENDPOINT = process.env.DEEPLX_URL ?? 'https://translate.jonas-strassel.de'
const TOKEN = process.env.DEEPLX_TOKEN
if (!TOKEN) {
  console.error('DEEPLX_TOKEN is not set. Run via `npm run rephrase` which loads .env.')
  process.exit(1)
}

const [input, ...flags] = process.argv.slice(2)
if (!input) {
  console.error('Usage: node scripts/rephrase.mjs <file|-> [--in-place] [--lang de]')
  process.exit(1)
}

const inPlace = flags.includes('--in-place')
const targetLang = flags.includes('--lang') ? flags[flags.indexOf('--lang') + 1] : 'de'

/**
 * DeepL Write 504s deterministically past ~200 characters *per sentence*, so
 * split on sentence boundaries rather than paragraphs and reassemble after.
 */
const MAX_SENTENCE_LENGTH = 185

function splitSentences(paragraph) {
  return paragraph.match(/[^.!?]+[.!?]+[\s]*|[^.!?]+$/g) ?? [paragraph]
}

async function rephraseSentence(sentence) {
  const trimmed = sentence.trim()
  if (!trimmed || trimmed.length > MAX_SENTENCE_LENGTH) return sentence

  const response = await fetch(`${ENDPOINT}/rephrase`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ text: trimmed, target_lang: targetLang }),
  })
  const payload = await response.json().catch(() => ({}))

  if (payload.code !== 200 || !payload.data) {
    console.error(`  ! kept original (${payload.code ?? response.status}): ${trimmed.slice(0, 60)}…`)
    return sentence
  }

  const [, lead = '', , trail = ''] = sentence.match(/^(\s*)([\s\S]*?)(\s*)$/) ?? []
  return `${lead}${payload.data}${trail}`
}

const raw = input === '-' ? await readFile(0, 'utf8') : await readFile(input, 'utf8')

const segments = raw.split(/(```[\s\S]*?```)/g)
const output = []

for (const segment of segments) {
  if (!segment || segment.startsWith('```')) {
    output.push(segment)
    continue
  }

  const paragraphs = segment.split(/\n{2,}/)
  const rephrasedParagraphs = []

  for (const paragraph of paragraphs) {
    // Headings, list markers and front matter keep their terse register.
    if (!paragraph.trim() || /^(#{1,6}\s|[-*+]\s|\d+\.\s|>|---)/.test(paragraph.trim())) {
      rephrasedParagraphs.push(paragraph)
      continue
    }

    const sentences = []
    for (const sentence of splitSentences(paragraph)) sentences.push(await rephraseSentence(sentence))
    const result = sentences.join('')

    if (result.trim() !== paragraph.trim()) {
      console.log(`\n- ${paragraph.trim()}\n+ ${result.trim()}`)
    }
    rephrasedParagraphs.push(result)
  }

  output.push(rephrasedParagraphs.join('\n\n'))
}

const result = output.join('')

if (input === '-') {
  process.stdout.write(result)
} else {
  const target = inPlace ? input : input.replace(/(\.[^.]+)$/, '.rephrased$1')
  await writeFile(target, result)
  console.log(`\n✓ ${target}`)
}
