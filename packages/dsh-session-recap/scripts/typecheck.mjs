import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const require = createRequire(import.meta.url)
const compiler = require.resolve('typescript/bin/tsc')
const project = fileURLToPath(new URL('../tsconfig.json', import.meta.url))

// Use the package's pinned compiler, never a global tsc or a downloader shim.
export async function typecheck() {
  try {
    await promisify(execFile)(
      process.execPath,
      [compiler, '--project', project, '--pretty', 'false'],
      {
        maxBuffer: 1024 * 1024,
      },
    )
  } catch (error) {
    throw new Error(
      `Session Recap type checking failed:\n${error.stdout || error.stderr || error.message}`,
    )
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await typecheck()
}
