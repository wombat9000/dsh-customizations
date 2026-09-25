import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const require = createRequire(import.meta.url)
const compiler = require.resolve('typescript/bin/tsc')

// Resolve the repository's pinned compiler, never a global tsc or downloader shim.
export async function typecheckClient(project, label) {
  try {
    await promisify(execFile)(
      process.execPath,
      [compiler, '--project', fileURLToPath(project), '--pretty', 'false'],
      { maxBuffer: 1024 * 1024 },
    )
  } catch (error) {
    throw new Error(
      `${label} type checking failed:\n${error.stdout || error.stderr || error.message}`,
    )
  }
}
