import { config, fields, collection, singleton } from '@keystatic/core'
import { locales, localeName, type Locale } from './src/i18n/config'

/**
 * GitHub storage in every environment. `kind: 'local'` writes through Node's fs,
 * which does not exist in the Cloudflare runtime the adapter uses for both
 * `astro dev` and production, so it fails with "exports is not defined" there.
 */
const storage = { kind: 'github', repo: { owner: 'boredland', name: 'rahlwes' } } as const

const seo = fields.object(
  {
    title: fields.text({ label: 'SEO-Titel', description: 'Erscheint im Browser-Tab und bei Google.' }),
    description: fields.text({
      label: 'SEO-Beschreibung',
      multiline: true,
      description: 'Ein bis zwei Sätze für Google und Social Media.',
    }),
  },
  { label: 'Suchmaschinen & Social Media' },
)

const body = fields.mdx({
  label: 'Inhalt',
  options: { image: { directory: 'src/assets/uploads', publicPath: '/uploads/' } },
})

/** One collection per locale keeps translations as separate files the webhook can write. */
function journalFor(locale: Locale) {
  return collection({
    label: `Journal (${localeName[locale]})`,
    slugField: 'title',
    path: `src/content/journal/${locale}/*`,
    format: { contentField: 'body' },
    columns: ['title', 'publishedAt'],
    entryLayout: 'content',
    schema: {
      title: fields.slug({ name: { label: 'Titel' } }),
      publishedAt: fields.date({ label: 'Veröffentlicht am', defaultValue: { kind: 'today' } }),
      draft: fields.checkbox({ label: 'Entwurf (nicht veröffentlichen)', defaultValue: false }),
      translated: fields.checkbox({
        label: 'Automatisch übersetzt',
        description: 'Abwählen, wenn dieser Text selbst geschrieben wurde – dann überschreibt ihn die Übersetzung nie.',
        defaultValue: true,
      }),
      excerpt: fields.text({ label: 'Teaser', multiline: true }),
      coverImage: fields.image({
        label: 'Titelbild',
        directory: 'src/assets/uploads',
        publicPath: '/uploads/',
      }),
      coverAlt: fields.text({ label: 'Bildbeschreibung (Alt-Text)' }),
      body,
      seo,
    },
  })
}

function projectsFor(locale: Locale) {
  return collection({
    label: `Projekte (${localeName[locale]})`,
    slugField: 'title',
    path: `src/content/projects/${locale}/*`,
    format: { contentField: 'body' },
    columns: ['title', 'order'],
    entryLayout: 'content',
    schema: {
      title: fields.slug({ name: { label: 'Titel' } }),
      order: fields.integer({ label: 'Reihenfolge', defaultValue: 0 }),
      category: fields.select({
        label: 'Kategorie',
        options: [
          { label: 'Ausstellungsprojekte', value: 'ausstellung' },
          { label: 'Digitale Kulturvermittlung', value: 'digital' },
          { label: 'Pädagogisches Material', value: 'material' },
        ],
        defaultValue: 'ausstellung',
      }),
      excerpt: fields.text({ label: 'Kurzbeschreibung', multiline: true }),
      coverImage: fields.image({
        label: 'Titelbild',
        directory: 'src/assets/uploads',
        publicPath: '/uploads/',
      }),
      coverAlt: fields.text({ label: 'Bildbeschreibung (Alt-Text)' }),
      body,
      seo,
    },
  })
}

function pagesFor(locale: Locale) {
  return collection({
    label: `Seiten (${localeName[locale]})`,
    slugField: 'title',
    path: `src/content/pages/${locale}/*`,
    format: { contentField: 'body' },
    columns: ['title'],
    entryLayout: 'content',
    schema: {
      title: fields.slug({ name: { label: 'Titel' } }),
      intro: fields.text({ label: 'Einleitung', multiline: true }),
      body,
      seo,
    },
  })
}

function homeFor(locale: Locale) {
  return singleton({
    label: `Startseite (${localeName[locale]})`,
    path: `src/content/home/${locale}/`,
    format: { data: 'json' },
    schema: {
      heroHeading: fields.text({ label: 'Überschrift' }),
      heroText: fields.text({ label: 'Einleitungstext', multiline: true }),
      heroCta: fields.text({ label: 'Button-Text' }),
      heroImage: fields.image({
        label: 'Portraitfoto',
        directory: 'src/assets/uploads',
        publicPath: '/uploads/',
      }),
      heroImageAlt: fields.text({ label: 'Bildbeschreibung (Alt-Text)' }),
      servicesHeading: fields.text({ label: 'Überschrift Leistungen' }),
      services: fields.array(
        fields.object({
          title: fields.text({ label: 'Titel' }),
          text: fields.text({ label: 'Beschreibung', multiline: true }),
          icon: fields.select({
            label: 'Symbol',
            options: [
              { label: 'Lupe (finden)', value: 'lucide:search' },
              { label: 'Buch (verstehen)', value: 'lucide:book-open' },
              { label: 'Sprechblase (vermitteln)', value: 'lucide:message-circle' },
              { label: 'Archiv', value: 'lucide:archive' },
              { label: 'Bild', value: 'lucide:image' },
            ],
            defaultValue: 'lucide:search',
          }),
        }),
        { label: 'Leistungen', itemLabel: (props) => props.fields.title.value || 'Leistung' },
      ),
      aboutHeading: fields.text({ label: 'Überschrift Über mich' }),
      aboutText: fields.text({ label: 'Einleitung Über mich', multiline: true }),
      journalHeading: fields.text({ label: 'Überschrift Journal' }),
      journalText: fields.text({ label: 'Einleitung Journal', multiline: true }),
      aboutBlocks: fields.array(
        fields.object({
          title: fields.text({ label: 'Titel' }),
          text: fields.text({ label: 'Text', multiline: true }),
        }),
        { label: 'Über-mich-Blöcke', itemLabel: (props) => props.fields.title.value || 'Block' },
      ),
      testimonials: fields.array(
        fields.object({
          quote: fields.text({ label: 'Zitat', multiline: true }),
          author: fields.text({ label: 'Wer hat das gesagt?' }),
          // Kept apart from the name so translations can render the role in the
          // reader's language while the person's name stays untouched.
          role: fields.text({ label: 'Funktion / Institution', multiline: true }),
        }),
        { label: 'Stimmen', itemLabel: (props) => props.fields.author.value || 'Stimme' },
      ),
      seo,
    },
  })
}

/** Dispatch renders these through the same MDX pipeline as the rest of the site. */
function newslettersFor(locale: Locale) {
  return collection({
    label: `Newsletter (${localeName[locale]})`,
    slugField: 'subject',
    path: `src/content/newsletters/${locale}/*`,
    format: { contentField: 'body' },
    columns: ['subject', 'status'],
    entryLayout: 'content',
    schema: {
      subject: fields.slug({ name: { label: 'Betreff', description: 'Die Betreffzeile der E-Mail.' } }),
      status: fields.select({
        label: 'Status',
        description: 'Nur „Bereit zum Versand“ erscheint auf der Versandseite.',
        options: [
          { label: 'Entwurf', value: 'draft' },
          { label: 'Bereit zum Versand', value: 'ready' },
          { label: 'Versendet', value: 'sent' },
        ],
        defaultValue: 'draft',
      }),
      body,
    },
  })
}

const collectionsByLocale = Object.fromEntries(
  locales.flatMap((locale) => [
    [`journal_${locale}`, journalFor(locale)],
    [`projects_${locale}`, projectsFor(locale)],
    [`pages_${locale}`, pagesFor(locale)],
    [`newsletters_${locale}`, newslettersFor(locale)],
  ]),
)

const singletonsByLocale = Object.fromEntries(locales.map((locale) => [`home_${locale}`, homeFor(locale)]))

export default config({
  storage,
  ui: {
    brand: { name: 'Rahlwes — Redaktion' },
    navigation: {
      Deutsch: ['home_de', 'pages_de', 'projects_de', 'journal_de', 'newsletters_de'],
      English: ['home_en', 'pages_en', 'projects_en', 'journal_en', 'newsletters_en'],
      Français: ['home_fr', 'pages_fr', 'projects_fr', 'journal_fr', 'newsletters_fr'],
    },
  },
  collections: collectionsByLocale,
  singletons: singletonsByLocale,
})
