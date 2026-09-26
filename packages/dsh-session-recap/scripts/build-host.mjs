import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildHost as compileHost, checkHost, writeHost } from '../../../scripts/build-host.mjs'

export function buildHost() {
  return compileHost(new URL('../tsconfig.host.json', import.meta.url))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.length && (args.length !== 1 || args[0] !== '--check')) {
    throw new Error('Usage: node scripts/build-host.mjs [--check]')
  }
  const output = buildHost()
  if (args[0] === '--check') checkHost(output)
  else writeHost(output)
}
