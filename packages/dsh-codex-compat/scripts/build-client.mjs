import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildClient as bundleClient, runBuildClient } from '../../../scripts/build-client.mjs'
import { typecheck } from './typecheck.mjs'
export const clientPath = new URL('../client.js', import.meta.url)
export const buildClient = () =>
  bundleClient({ packageRoot: new URL('../', import.meta.url), defaultExport: true })
export const oauthClientPath = new URL('../oauth/client.js', import.meta.url)
export const buildOAuthClient = () =>
  bundleClient({ packageRoot: new URL('../oauth/', import.meta.url), defaultExport: true })
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const checked = typecheck()
  for (const [build, path] of [
    [buildClient, clientPath],
    [buildOAuthClient, oauthClientPath],
  ]) {
    await runBuildClient({
      buildClient: build,
      clientPath: path,
      typecheck: () => checked,
      command: 'node packages/dsh-codex-compat/scripts/build-client.mjs',
    })
  }
}
