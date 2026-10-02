import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildClient as bundleClient, runBuildClient } from '../../../scripts/build-client.mjs'
import { typecheckBrowser } from './typecheck.mjs'
export function buildClient() {
  return bundleClient({ packageRoot: new URL('../', import.meta.url) })
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runBuildClient({
    buildClient,
    clientPath: new URL('../client.js', import.meta.url),
    typecheck: typecheckBrowser,
    command: 'node packages/dsh-linear/scripts/build-client.mjs',
  })
}
