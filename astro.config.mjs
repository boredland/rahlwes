import { defineConfig, fontProviders } from 'astro/config'
import { fileURLToPath } from 'url'
import cloudflare from '@astrojs/cloudflare'
import icon from 'astro-icon'
import mdx from '@astrojs/mdx'
import react from '@astrojs/react'
import sitemap from '@astrojs/sitemap'
import keystatic from '@keystatic/astro'
import tailwindcss from '@tailwindcss/vite'
import { legacyRedirects } from './src/redirects.ts'
import { queueConsumer } from './src/newsletter/integration.ts'

const viteConfig = {
  css: {
    preprocessorOptions: {
      scss: {
        loadPaths: [fileURLToPath(new URL('./src/assets', import.meta.url))],
        logger: {
          warn: () => {},
        },
      },
    },
  },
  plugins: [tailwindcss()],
  resolve: {
    alias: {
      '@components': fileURLToPath(new URL('./src/components', import.meta.url)),
      '@layouts': fileURLToPath(new URL('./src/layouts', import.meta.url)),
      '@assets': fileURLToPath(new URL('./src/assets', import.meta.url)),
      '@content': fileURLToPath(new URL('./src/content', import.meta.url)),
      '@pages': fileURLToPath(new URL('./src/pages', import.meta.url)),
      '@public': fileURLToPath(new URL('./public', import.meta.url)),
      '@utils': fileURLToPath(new URL('./src/utils', import.meta.url)),
      '@i18n': fileURLToPath(new URL('./src/i18n', import.meta.url)),
      '@newsletter': fileURLToPath(new URL('./src/newsletter', import.meta.url)),
      '@theme-config': fileURLToPath(new URL('./theme.config.ts', import.meta.url)),
    },
  },
}

export default defineConfig({
  compressHTML: true,
  site: 'https://next.rahlwes.eu',
  adapter: cloudflare({ imageService: 'compile' }),
  integrations: [
    icon(),
    mdx(),
    react(),
    keystatic(),
    sitemap({
      i18n: { defaultLocale: 'de', locales: { de: 'de-DE', en: 'en-GB', fr: 'fr-FR' } },
      filter: (page) => !page.includes('/admin/'),
    }),
    // Must come after the adapter has registered, so it can wrap the worker entry.
    queueConsumer(),
  ],
  // 301s from the Squarespace URLs; see src/redirects.ts.
  redirects: legacyRedirects,
  i18n: {
    locales: ['de', 'en', 'fr'],
    defaultLocale: 'de',
    routing: { prefixDefaultLocale: false, redirectToDefaultLocale: false },
  },
  fonts: [
    {
      provider: fontProviders.google(),
      name: 'PT Sans',
      cssVariable: '--font-pt-sans',
      weights: [400, 700],
      styles: ['normal'],
      subsets: ['latin', 'latin-ext'],
      fallbacks: ['ui-sans-serif', 'system-ui', 'sans-serif'],
    },
  ],
  vite: viteConfig,
})
