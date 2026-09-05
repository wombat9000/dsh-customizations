import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'

export default defineConfig({
  test: {
    include: ['packages/*/test/browser/*.browser.test.mjs'],
    // Component interactions only. Real-host visual comparisons use playwright.config.mjs.
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({
        contextOptions: {
          locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light',
          reducedMotion: 'reduce', deviceScaleFactor: 1,
        },
      }),
      instances: [{ browser: 'chromium' }],
      viewport: { width: 1000, height: 800 },
      screenshotDirectory: 'artifacts/browser',
      screenshotFailures: true,
    },
  },
})
