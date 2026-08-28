import { defineThemeConfig } from './src/utils/defineThemeConfig'

/**
 * Brand-level settings only. Navigation labels and page copy are localized —
 * see src/i18n/nav.ts and the Keystatic content collections.
 */
export default defineThemeConfig({
  name: 'Ann-Kathrin Rahlwes',
  id: 'rahlwes',
  logo: null,
  seo: {
    title: 'Ann-Kathrin Rahlwes — Historikerin',
    subtitle: 'Let’s talk about history!',
    description:
      'Ich unterstütze Familien, Unternehmen & Museen dabei, historische Zeugnisse zu finden, Geschichte zu erforschen & zu erzählen.',
    author: 'Ann-Kathrin Rahlwes',
    image: null,
  },
  colors: {
    primary: '#6673b6',
    secondary: '#6f534f',
    neutral: '#c4bab4',
    outline: '#b6664f',
  },
  navigation: {
    darkmode: true,
    items: [],
  },
  socials: [
    { label: 'E-Mail', href: 'mailto:info@rahlwes.eu', icon: 'lucide:mail' },
    { label: 'LinkedIn', href: 'https://www.linkedin.com/in/ann-kathrin-rahlwes/', icon: 'lucide:linkedin' },
  ],
})
