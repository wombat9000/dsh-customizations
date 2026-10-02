import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildClient as bundleClient, runBuildClient } from '../../../scripts/build-client.mjs'
import { typecheckClient } from '../../../scripts/typecheck-client.mjs'

export const clientPath = new URL('../client.js', import.meta.url)
export function typecheck() {
  return typecheckClient(new URL('../tsconfig.json', import.meta.url), 'Imagegen client')
}
export function buildClient() {
  return bundleClient({ packageRoot: new URL('../', import.meta.url) })
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runBuildClient({
    buildClient,
    clientPath,
    typecheck,
    command: 'node packages/dsh-tool-imagegen/scripts/build-client.mjs',
  })
}
