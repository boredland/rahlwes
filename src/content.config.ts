import { defineCollection } from 'astro:content'
import { z } from 'astro/zod'
import { glob } from 'astro/loaders'
import { locales } from './i18n/config'

const localeEnum = z.enum(locales)

const seoSchema = z
  .object({
    title: z.string().optional(),
    description: z.string().optional(),
  })
  .default({})

/** Locale lives in the first path segment (`de/my-post.mdx`), written by Keystatic. */
const journal = defineCollection({
  loader: glob({ pattern: '*/*.mdx', base: './src/content/journal' }),
  schema: z.object({
    title: z.string(),
    publishedAt: z.coerce.date(),
    draft: z.boolean().default(false),
    /** False when the text is hers rather than machine-translated; see scripts/translate.mjs. */
    translated: z.boolean().default(true),
    excerpt: z.string().default(''),
    coverImage: z.string().nullable().optional(),
    coverAlt: z.string().default(''),
    seo: seoSchema,
  }),
})

const projects = defineCollection({
  loader: glob({ pattern: '*/*.mdx', base: './src/content/projects' }),
  schema: z.object({
    title: z.string(),
    order: z.number().default(0),
    category: z.enum(['ausstellung', 'digital', 'material']).default('ausstellung'),
    excerpt: z.string().default(''),
    coverImage: z.string().nullable().optional(),
    coverAlt: z.string().default(''),
    seo: seoSchema,
  }),
})

const pages = defineCollection({
  loader: glob({ pattern: '*/*.mdx', base: './src/content/pages' }),
  schema: z.object({
    title: z.string(),
    /** False for legal texts and anything she wrote herself; see scripts/translate.mjs. */
    translated: z.boolean().default(true),
    intro: z.string().default(''),
    seo: seoSchema,
  }),
})

/** Authored in Keystatic, rendered to HTML at dispatch time; never routed on the site. */
const newsletters = defineCollection({
  loader: glob({ pattern: '*/*.mdx', base: './src/content/newsletters' }),
  schema: z.object({
    subject: z.string(),
    status: z.enum(['draft', 'ready', 'sent']).default('draft'),
  }),
})

const home = defineCollection({
  loader: glob({ pattern: '*/index.json', base: './src/content/home' }),
  schema: z.object({
    heroHeading: z.string(),
    heroText: z.string(),
    heroCta: z.string(),
    heroImage: z.string().nullable().optional(),
    heroImageAlt: z.string().default(''),
    servicesHeading: z.string(),
    services: z
      .array(z.object({ title: z.string(), text: z.string(), icon: z.string() }))
      .default([]),
    aboutHeading: z.string(),
    aboutText: z.string().default(''),
    journalHeading: z.string().default(''),
    journalText: z.string().default(''),
    aboutBlocks: z.array(z.object({ title: z.string(), text: z.string() })).default([]),
    testimonials: z
      .array(z.object({ quote: z.string(), author: z.string(), role: z.string().default('') }))
      .default([]),
    seo: seoSchema,
  }),
})

export const collections = { journal, projects, pages, home, newsletters }
export { localeEnum }
