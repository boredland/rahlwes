export type SocialItem = {
  label: string
  href: string
  icon: string
}

/**
 * Brand settings that are the same in every language. Anything a reader sees as text
 * — the tagline, the description, the page titles — is translated and lives in
 * `src/i18n/ui.ts` instead, so there is exactly one place it can go stale.
 */
export type ThemeConfig = {
  name: string
  seo: {
    author: string
  }
  colors: {
    primary: string
    secondary: string
    neutral: string
    accent: string
  }
  navigation: {
    darkmode: boolean
  }
  socials: SocialItem[]
}

export function defineThemeConfig(config: ThemeConfig): ThemeConfig {
  return config
}
