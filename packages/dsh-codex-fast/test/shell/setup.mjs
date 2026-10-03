import { fileURLToPath } from 'node:url'
import { startDisposableHost } from '../../../../tests/real-ui/global-setup.mjs'
export default async function setup() {
  return startDisposableHost({
    additionalPlugins: [{ name: '@local/dsh-codex-fast', directory: 'packages/dsh-codex-fast' }],
    profilePatch: fileURLToPath(new URL('./profile.yml', import.meta.url)),
  })
}
