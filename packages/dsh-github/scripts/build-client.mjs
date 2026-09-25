import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildClient as bundleClient, runBuildClient } from '../../../scripts/build-client.mjs'
import { typecheck } from './typecheck.mjs'

export const clientPath = new URL('../client.js', import.meta.url)

export function buildClient() {
  return bundleClient({ packageRoot: new URL('../', import.meta.url), defaultExport: true })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runBuildClient({
    buildClient,
    clientPath,
    typecheck,
    command: 'node packages/dsh-github/scripts/build-client.mjs',
  })
}
