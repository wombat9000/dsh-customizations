import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { typecheckClient } from '../../../scripts/typecheck-client.mjs'

export function typecheck() {
  return typecheckClient(new URL('../tsconfig.json', import.meta.url), 'Firecrawl client')
}
export function typecheckHost() {
  return typecheckClient(new URL('../tsconfig.host.json', import.meta.url), 'Firecrawl host')
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await typecheckHost()
  await typecheck()
}
