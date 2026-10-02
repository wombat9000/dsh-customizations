import { fileURLToPath } from 'node:url'
import base from '../../../vitest.browser.config.mjs'

// Reuse the repository browser runner without writing into borrowed node_modules.
export default {
  ...base,
  cacheDir: fileURLToPath(new URL('./artifacts/vite/', import.meta.url)),
  test: {
    ...base.test,
    include: ['packages/dsh-google-drive/test/browser/*.browser.test.mjs'],
    browser: {
      ...base.test.browser,
      screenshotDirectory: fileURLToPath(new URL('./artifacts/browser/', import.meta.url)),
    },
  },
}
