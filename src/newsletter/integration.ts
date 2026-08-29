import type { AstroIntegration } from 'astro'
import { fileURLToPath } from 'node:url'

const WORKER_ENTRY = fileURLToPath(new URL('../worker.ts', import.meta.url))

/**
 * Points the SSR build at `src/worker.ts` instead of the adapter's entrypoint.
 *
 * The Cloudflare adapter exports only `{ fetch }`, so a queue consumer has nowhere
 * to live. Astro builds `adapter.serverEntrypoint` into `dist/server/entry.mjs`,
 * and the generated `wrangler.json` names that file as the Worker's `main`, so its
 * exports are the Worker's exports. Redirecting the build input to a module that
 * re-exports the adapter's `fetch` alongside a `queue` handler puts the consumer in
 * the same Worker without forking the adapter.
 *
 * The override happens in `configResolved` rather than `config`, because Astro's
 * own `astro:adapter-config` plugin sets the input from the adapter and plugin
 * order between the two is not guaranteed.
 */
export function queueConsumer(): AstroIntegration {
  return {
    name: 'rahlwes:queue-consumer',
    hooks: {
      'astro:config:setup': ({ updateConfig }) => {
        updateConfig({
          vite: {
            plugins: [
              {
                name: 'rahlwes:queue-consumer-entry',
                enforce: 'post',
                configResolved(resolved) {
                  const ssr = resolved.environments?.ssr
                  if (!ssr) return

                  const rolldownOptions = ssr.build.rolldownOptions ?? (ssr.build.rolldownOptions = {})
                  rolldownOptions.input = { index: WORKER_ENTRY }
                },
              },
            ],
          },
        })
      },
    },
  }
}
