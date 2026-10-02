import { fileURLToPath } from 'node:url'
import shared from '../../vitest.browser.config.mjs'

// Worktrees can borrow dependencies read-only. Keep all runner writes here,
// rather than following the shared node_modules link for Vite's default cache.
export default {
  ...shared,
  cacheDir: fileURLToPath(new URL('./.cache/vitest', import.meta.url)),
  test: {
    ...shared.test,
    include: ['packages/dsh-web-firecrawl/test/browser/*.browser.test.mjs'],
    browser: {
      ...shared.test.browser,
      screenshotDirectory: fileURLToPath(new URL('./.cache/browser', import.meta.url)),
    },
  },
}
