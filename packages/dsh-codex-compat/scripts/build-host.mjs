import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildHost as compileHost, checkHost, writeHost } from '../../../scripts/build-host.mjs'
export const buildHost = () => compileHost(new URL('../tsconfig.host.json', import.meta.url))
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = buildHost()
  if (process.argv.slice(2).join(' ') === '--check') checkHost(output)
  else if (process.argv.length === 2) writeHost(output)
  else throw new Error('Usage: node scripts/build-host.mjs [--check]')
}
