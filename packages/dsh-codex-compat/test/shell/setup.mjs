import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { installed } from '../../../dsh-google-auth/test/profile-fixture.js'
import { fileURLToPath } from 'node:url'
import { startDisposableHost } from '../../../../tests/real-ui/global-setup.mjs'
export default async function setup() {
  return startDisposableHost({
    async prepareHome(home) {
      const { default: CredentialsLocal } = await installed('@deepseek-ai/dsh-credentials-local')
      const { credentialKey } = await installed('@deepseek-ai/dsh-credentials')
      const ctx = new Context()
      try {
        await ctx
          .plugin(CredentialsLocal, {
            path: join(home, '.credentials.yaml'),
            watch: false,
            dotenvPaths: [],
          })
          .await()
        await ctx.credentials.modifyRecord(credentialKey('llm-pi-ai', 'openai-codex'), async () => ({
          kind: 'grant',
          payload: { access: 'synthetic-already-configured' },
        }))
      } finally {
        await ctx.fiber.dispose()
      }
    },
    additionalPlugins: [
      { name: '@local/dsh-codex-compat', directory: 'packages/dsh-codex-compat' },
    ],
    profilePatch: fileURLToPath(new URL('./profile.yml', import.meta.url)),
  })
}
