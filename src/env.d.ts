/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />
/// <reference types="@astrojs/cloudflare/types" />
/// <reference types="../worker-configuration.d.ts" />

interface Window {
  /** Injected by the Turnstile script when a widget is present on the page. */
  turnstile?: { reset: (widget?: string) => void }
}
