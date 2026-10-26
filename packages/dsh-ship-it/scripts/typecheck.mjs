import { typecheckClient } from '../../../scripts/typecheck-client.mjs'

export function typecheck() {
  return typecheckClient(new URL('../tsconfig.json', import.meta.url), 'Ship it client')
}

if (process.argv[1]?.endsWith('/scripts/typecheck.mjs')) await typecheck()
