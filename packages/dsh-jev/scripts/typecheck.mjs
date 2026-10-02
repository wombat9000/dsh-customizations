import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { typecheckClient } from '../../../scripts/typecheck-client.mjs'
export async function typecheck() {
  await typecheckClient(new URL('../tsconfig.host.json', import.meta.url), 'Jev host')
  await typecheckClient(new URL('../tsconfig.json', import.meta.url), 'Jev client')
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await typecheck()
