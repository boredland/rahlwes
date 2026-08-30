import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

/**
 * Plain Node pool: these tests exercise pure logic — parsers, relevance ranking, the
 * fan-out — against a mocked `fetch`, so no Worker runtime is needed and no request
 * leaves the machine. Adapter behaviour against live upstreams is checked separately.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@ankai': fileURLToPath(new URL('./src/ankai', import.meta.url)),
    },
  },
})
