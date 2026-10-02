import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { typecheckClient } from '../../../scripts/typecheck-client.mjs'
export function typecheckHost() {
  return typecheckClient(new URL('../tsconfig.host.json', import.meta.url), 'Google auth host')
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await typecheckHost()
