import { defineThemeConfig } from './src/utils/defineThemeConfig'

/**
 * Brand-level settings only. Navigation labels and page copy are localized —
 * see src/i18n/nav.ts and the Keystatic content collections.
 */
export default defineThemeConfig({
  name: 'Ann-Kathrin Rahlwes',
  seo: {
    author: 'Ann-Kathrin Rahlwes',
  },
  colors: {
    primary: '#6673b6',
    secondary: '#6f534f',
    neutral: '#c4bab4',
    accent: '#f17018',
  },
  navigation: {
    darkmode: true,
  },
  socials: [
    { label: 'E-Mail', href: 'mailto:info@rahlwes.eu', icon: 'lucide:mail' },
    { label: 'LinkedIn', href: 'https://www.linkedin.com/in/ann-kathrin-rahlwes/', icon: 'lucide:linkedin' },
  ],
})
