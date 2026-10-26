import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildHost as compileHost, checkHost, writeHost } from '../../../scripts/build-host.mjs'

export function buildHost() {
  return compileHost(new URL('../tsconfig.host.json', import.meta.url))
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = buildHost()
  if (process.argv.includes('--check')) checkHost(output)
  else writeHost(output)
}
