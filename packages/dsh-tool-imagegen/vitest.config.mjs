import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'

// Borrowed node_modules is read-only. Keep all Vite/browser outputs package-local.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  cacheDir: fileURLToPath(new URL('.vitest/cache', import.meta.url)),
  test: {
    cache: false,
    include: ['test/client.browser.test.tsx'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
      screenshotDirectory: fileURLToPath(new URL('.vitest/screenshots', import.meta.url)),
      screenshotFailures: true,
    },
  },
})
