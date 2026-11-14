import { defineConfig } from '@playwright/test'
import base from '../../../playwright.config.mjs'
// A separate profile is necessary: the scripted model route and retained worktrees
// conflict with the deliberately unconfigured provider graph of the shared suite.
export default defineConfig({
  ...base,
  testDir: './shell',
  testMatch: '*.spec.mjs',
  globalSetup: './shell/setup.mjs',
  timeout: 90000,
  outputDir: '../../../artifacts/dispatch',
})
