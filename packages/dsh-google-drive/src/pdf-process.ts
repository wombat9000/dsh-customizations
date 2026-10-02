import type { Stats } from 'node:fs'
export type PdfToolName = 'pdfinfo' | 'pdftotext' | 'pdftoppm' | 'tesseract'
type InstalledToolName = PdfToolName | 'prlimit' | 'python3'
export type PdfTools = Record<PdfToolName, string> &
  (
    | { platform: 'linux'; prlimit: string; python3?: never }
    | { platform: 'darwin'; python3: string; prlimit?: never }
  )
export interface PdfProcessOptions {
  cwd?: string | undefined
  signal?: AbortSignal | undefined
  timeout?: number
  limit?: number
}
import { spawn } from 'node:child_process'
import { access, realpath, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname } from 'node:path'

const directories = ['/usr/bin', '/usr/local/bin', '/opt/homebrew/bin']
// macOS enforces CPU/files/descriptors/core limits, but not a hard memory limit.
// Neither native runner is a security sandbox. Untrusted PDFs retain native-parser risk.
const macLimiter = `import os,resource,sys
resource.setrlimit(resource.RLIMIT_CPU,(30,30))
resource.setrlimit(resource.RLIMIT_FSIZE,(33554432,33554432))
resource.setrlimit(resource.RLIMIT_NOFILE,(64,64))
resource.setrlimit(resource.RLIMIT_CORE,(0,0))
os.execve(sys.argv[1],sys.argv[1:],dict(os.environ))`
export function pdfInvocation(
  tools: PdfTools,
  name: PdfToolName,
  args: string[],
): [string, string[]] {
  if (tools.platform === 'darwin')
    return [tools.python3, ['-I', '-c', macLimiter, tools[name], ...args]]
  return [
    tools.prlimit,
    [
      '--as=536870912:536870912',
      '--cpu=30:30',
      '--fsize=33554432:33554432',
      '--nofile=64:64',
      '--core=0:0',
      '--',
      tools[name],
      ...args,
    ],
  ]
}
export function trustedPdfToolMode(
  info: Pick<Stats, 'uid' | 'gid' | 'mode'>,
  platform: string = process.platform,
  uid = process.getuid!(),
) {
  return (
    [0, uid].includes(info.uid) &&
    !(info.mode & 0o002) &&
    (!(info.mode & 0o020) || (platform === 'darwin' && info.gid === 80))
  )
}
export async function pdfTools() {
  if (process.platform !== 'linux' && process.platform !== 'darwin')
    throw new Error('PDF processing requires Linux or macOS with local resource-limiting tools.')
  const tools: Partial<PdfTools> = { platform: process.platform }
  for (const name of [
    process.platform === 'linux' ? 'prlimit' : 'python3',
    'pdfinfo',
    'pdftotext',
    'pdftoppm',
    'tesseract',
  ] as InstalledToolName[]) {
    // Avoid Apple's developer-tools python shim: it can prompt for an install.
    const search =
      process.platform === 'darwin' && name === 'python3'
        ? ['/opt/homebrew/bin', '/usr/local/bin']
        : directories
    for (const directory of search) {
      const path = `${directory}/${name}`
      try {
        await access(path, constants.X_OK)
        const resolved = await realpath(path)
        if (!resolved.startsWith('/usr/') && !resolved.startsWith('/opt/homebrew/')) continue
        const info = await stat(resolved)
        if (!info.isFile() || !trustedPdfToolMode(info)) continue
        let ancestor = dirname(resolved),
          trusted = true
        while (ancestor !== '/') {
          const parent = await stat(ancestor)
          if (!trustedPdfToolMode(parent)) {
            trusted = false
            break
          }
          ancestor = dirname(ancestor)
        }
        if (!trusted) continue
        tools[name] = resolved
        break
      } catch {
        /* Only search administrator-controlled locations. */
      }
    }
    if (!tools[name])
      throw new Error(`PDF processing requires an administrator-installed ${name} binary.`)
  }
  return tools as PdfTools
}

export function pdfProcess(
  tools: PdfTools,
  name: PdfToolName,
  args: string[],
  { cwd, signal, timeout = 10_000, limit = 1_048_576 }: PdfProcessOptions = {},
) {
  return new Promise<Buffer>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('PDF processing was cancelled.'))
    const [executable, argv] = pdfInvocation(tools, name, args)
    const child = spawn(executable, argv, {
      cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { LANG: 'C', LC_ALL: 'C', HOME: cwd, TMPDIR: cwd, OMP_THREAD_LIMIT: '1' },
    })
    let error: Error | undefined,
      killTimer: ReturnType<typeof setTimeout> | undefined,
      size = 0,
      stderrSize = 0
    const chunks: Buffer[] = []
    const kill = (sig: NodeJS.Signals) => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, sig)
      } catch {
        /* Already exited. */
      }
    }
    const stop = (message: string) => {
      if (error) return
      error = new Error(message)
      kill('SIGTERM')
      killTimer = setTimeout(() => kill('SIGKILL'), 150)
    }
    const abort = () => stop('PDF processing was cancelled.')
    const timer = setTimeout(() => stop('PDF processing exceeded its time limit.'), timeout)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) stop('PDF processing exceeded its output limit.')
      else if (!error) chunks.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrSize += chunk.length
      if (stderrSize > 65_536) stop('PDF processing exceeded its diagnostic limit.')
    })
    child.on('error', () => stop('PDF processing could not start a required tool.'))
    child.on('close', (code) => {
      clearTimeout(timer)
      clearTimeout(killTimer)
      signal?.removeEventListener('abort', abort)
      // Kill surviving members before the caller removes private temporary files.
      kill('SIGKILL')
      if (error) reject(error)
      else if (code !== 0)
        reject(
          new Error(
            'PDF processing failed: the document is malformed, encrypted, or exceeds processing limits.',
          ),
        )
      else resolve(Buffer.concat(chunks))
    })
  })
}
