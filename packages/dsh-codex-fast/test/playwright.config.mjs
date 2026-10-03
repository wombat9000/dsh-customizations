import { defineConfig } from '@playwright/test'
import base from '../../../playwright.config.mjs'
// A separate profile is necessary: Codex model discovery/defaults conflict with the
// deliberately unconfigured provider graph in the shared visual-regression suite.
export default defineConfig({
  ...base,
  testDir: './shell',
  testMatch: '*.spec.mjs',
  globalSetup: './shell/setup.mjs',
  outputDir: '../../../artifacts/codex-fast',
})
