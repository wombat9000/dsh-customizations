import { fileURLToPath } from 'node:url'
import { startDisposableHost } from '../../../../tests/real-ui/global-setup.mjs'

export default async function setup() {
  return startDisposableHost({
    additionalPlugins: [
      { name: '@local/dsh-dispatch', directory: 'packages/dsh-dispatch' },
      {
        name: '@local/dsh-dispatch-shell-fixture',
        directory: 'packages/dsh-dispatch/test/shell/fixture',
      },
    ],
    profilePatch: fileURLToPath(new URL('./profile.yml', import.meta.url)),
  })
}
