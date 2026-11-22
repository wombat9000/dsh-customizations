import { fileURLToPath } from 'node:url'
import { startDisposableHost } from '../../../../tests/real-ui/global-setup.mjs'
export default async function setup() {
  return startDisposableHost({
    additionalPlugins: [
      { name: '@local/dsh-codex-compat', directory: 'packages/dsh-codex-compat' },
    ],
    profilePatch: fileURLToPath(new URL('./profile.yml', import.meta.url)),
  })
}
