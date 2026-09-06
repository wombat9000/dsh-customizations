import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: 'packages/*/test/real-ui/*.spec.mjs',
  testIgnore: '**/.dsh/**', // Retained worktrees are not this checkout's tests.
  globalSetup: './tests/real-ui/global-setup.mjs',
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 30000,
  updateSnapshots: 'none',
  outputDir: 'artifacts/real-ui',
  reporter: [['list']],
  use: {
    browserName: 'chromium', headless: true,
    viewport: { width: 1100, height: 850 },
    locale: 'en-US', timezoneId: 'UTC', deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    trace: 'off', video: 'off', screenshot: 'only-on-failure',
  },
  expect: { toHaveScreenshot: { animations: 'disabled', caret: 'hide', maxDiffPixels: 0, threshold: 0 } },
})
