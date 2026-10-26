// Execution-world recorder: this module is sent over subprocess stdin, not run
// against Host filesystem paths. Based on the interaction recorder workflow in
// Amp's using-agent-browser skill: real pointer paths, action intervals, MP4/WebP.
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile, rm, readdir, stat, lstat, realpath } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, dirname, isAbsolute } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

export type Action =
  'hover' | 'click' | 'fill' | 'type' | 'press' | 'move' | 'scroll' | 'wait' | 'snapshot'
export interface Request {
  operation: 'start' | 'action' | 'stop' | 'discard'
  id: string
  directory?: string
  url?: string
  action?: Action
  target?: string
  value?: string
}
interface State {
  id: string
  session: string
  cwd: string
  startedAt: number
  stoppedAt?: number
  events: Array<{ start: number; end: number }>
}

export function validateAction(action: string, target = '', value = '') {
  if (
    !['hover', 'click', 'fill', 'type', 'press', 'move', 'scroll', 'wait', 'snapshot'].includes(
      action,
    )
  )
    throw new Error(
      'Unsupported recording action; arbitrary browser commands and JavaScript are not exposed',
    )
  if (target.startsWith('-') || value.startsWith('--'))
    throw new Error('Browser option injection is not allowed')
  if (target.length > 1000 || value.length > 2000) throw new Error('Recording input is too long')
  if (['hover', 'click', 'fill', 'type', 'wait'].includes(action) && !target.trim())
    throw new Error('This action requires a selector or snapshot reference')
  if (
    action === 'press' &&
    !/^(Enter|Space|Tab|Shift\+Tab|Escape|Backspace|Delete|Arrow(?:Up|Down|Left|Right)|Control\+a|Meta\+a)$/.test(
      value,
    )
  )
    throw new Error(
      'Unsupported key; clipboard, developer shortcuts and arbitrary key sequences are not exposed',
    )
  if (action === 'move' && !/^\d{1,4},\d{1,4}$/.test(value))
    throw new Error('Move requires x,y coordinates')
  if (action === 'scroll' && !/^(up|down|left|right)$/.test(value))
    throw new Error('Invalid scroll direction')
}

export function mergeIntervals(events: State['events'], duration: number, wall: number) {
  const scale = duration / Math.max(wall, 0.001)
  const intervals = [
    { start: 0, end: Math.min(0.4, duration) },
    ...events.map((event) => ({
      start: Math.max(0, event.start * scale - 0.25),
      end: Math.min(duration, event.end * scale + 0.6),
    })),
    { start: Math.max(0, duration - 0.35), end: duration },
  ].sort((a, b) => a.start - b.start)
  const merged: State['events'] = []
  for (const interval of intervals) {
    const previous = merged.at(-1)
    if (previous && interval.start <= previous.end)
      previous.end = Math.max(previous.end, interval.end)
    else merged.push({ ...interval })
  }
  return merged
}

// Child argv is never shell-interpreted. Scrub inherited browser configuration
// so an isolated recorder cannot attach to a user's profile or CDP session.
async function run(command: string, args: string[], directory: string, timeout = 30_000) {
  const env = { ...process.env }
  for (const key of Object.keys(env)) if (key.startsWith('AGENT_BROWSER_')) delete env[key]
  env.AGENT_BROWSER_NAMESPACE = 'dsh-recording'
  const child = spawn(command, args, { cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  let errorOutput = ''
  child.stdout.on('data', (chunk) => {
    output = (output + String(chunk)).slice(-128 * 1024)
  })
  child.stderr.on('data', (chunk) => {
    errorOutput = (errorOutput + String(chunk)).slice(-4096)
  })
  const timer = setTimeout(() => child.kill('SIGKILL'), timeout)
  const terminate = () => child.kill('SIGKILL')
  process.once('SIGTERM', terminate)
  try {
    await new Promise<void>((ok, fail) => {
      child.once('error', fail)
      child.once('close', (code) =>
        code === 0
          ? ok()
          : fail(
              new Error(`${command} failed (${code ?? 'terminated'}): ${errorOutput || output}`),
            ),
      )
    })
    return output
  } finally {
    clearTimeout(timer)
    process.removeListener('SIGTERM', terminate)
  }
}

async function chromePath() {
  const configured = process.env.AGENT_BROWSER_EXECUTABLE_PATH
  if (configured) {
    if (!isAbsolute(configured)) throw new Error('AGENT_BROWSER_EXECUTABLE_PATH must be absolute')
    return configured
  }
  const base = join(homedir(), '.agent-browser', 'browsers')
  const versions = (await readdir(base))
    .filter((name) => /^chrome-\d/.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .reverse()
  for (const version of versions) {
    for (const leaf of [
      'chrome',
      'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    ]) {
      const path = join(base, version, leaf)
      if (
        await stat(path).then(
          (s) => s.isFile(),
          () => false,
        )
      )
        return path
    }
  }
  throw new Error(
    'Preinstalled Chromium is required; set AGENT_BROWSER_EXECUTABLE_PATH in the execution environment',
  )
}

export async function record(request: Request): Promise<Record<string, unknown>> {
  if (!/^[a-f0-9-]{36}$/.test(request.id)) throw new Error('Invalid recording identity')
  if (request.operation === 'start') {
    const url = new URL(request.url ?? '')
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new Error('Recording requires an HTTP(S) URL without embedded credentials')
    const chrome = await chromePath()
    // Preflight before opening a browser. Never provision tools automatically.
    for (const command of ['agent-browser', 'ffmpeg', 'ffprobe'])
      await run(
        command,
        ['-version'].map((arg) => (command === 'agent-browser' ? '--version' : arg)),
        process.cwd(),
      )
    const directory = join(tmpdir(), `dsh-browser-recording-${request.id}`)
    await mkdir(directory, { mode: 0o700 })
    const state: State = {
      id: request.id,
      session: `dshr-${request.id.slice(0, 12)}`,
      cwd: await realpath(process.cwd()),
      startedAt: 0,
      events: [],
    }
    const browser = (args: string[]) =>
      run('agent-browser', ['--session', state.session, ...args], directory)
    try {
      await writeFile(join(directory, 'state.json'), JSON.stringify(state), { mode: 0o600 })
      if (process.platform === 'win32')
        throw new Error('The recorder currently supports Linux and macOS execution environments')
      const wrapperPath = join(directory, 'chrome.mjs')
      await writeFile(
        wrapperPath,
        `#!${process.execPath}\nimport { spawnSync } from 'node:child_process';\nconst r = spawnSync(${JSON.stringify(chrome)}, ['--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4', ...process.argv.slice(2)], {stdio:'inherit'}); process.exit(r.status ?? 1);\n`,
        { mode: 0o700 },
      )
      await browser(['--executable-path', wrapperPath, 'open', url.href])
      await browser(['set', 'viewport', '1280', '720', '2'])
      const hover = JSON.parse(
        await browser(['eval', "matchMedia('(hover: hover)').matches", '--json']),
      ) as { data?: { result?: unknown } }
      if (hover.data?.result !== true)
        throw new Error('Browser did not expose a hover-capable pointer')
      await browser(['record', 'start', join(directory, 'raw.mp4'), '--cursor'])
      state.startedAt = Date.now()
      await writeFile(join(directory, 'state.json'), JSON.stringify(state), { mode: 0o600 })
      return { directory, recordingId: request.id, snapshot: await browser(['snapshot', '-i']) }
    } catch (error) {
      await browser(['close']).catch(() => {})
      await rm(directory, { recursive: true, force: true })
      throw error
    }
  }
  const directory = request.directory ?? join(tmpdir(), `dsh-browser-recording-${request.id}`)
  if (directory !== join(tmpdir(), `dsh-browser-recording-${request.id}`))
    throw new Error('Invalid recording directory')
  if (
    request.operation === 'discard' &&
    !(await stat(directory).then(
      () => true,
      () => false,
    ))
  )
    return { discarded: true }
  const state = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')) as State
  if (state.id !== request.id) throw new Error('Recording owner does not match')
  const browser = (args: string[]) =>
    run('agent-browser', ['--session', state.session, ...args], directory)
  if (request.operation === 'discard') {
    await browser(['close'])
    await rm(directory, { recursive: true, force: true })
    return { discarded: true }
  }
  if (request.operation === 'action') {
    if (state.stoppedAt !== undefined)
      throw new Error('This recording has stopped; retry export or discard it')
    const action = request.action ?? ''
    const target = request.target ?? ''
    const value = request.value ?? ''
    validateAction(action, target, value)
    const started = Date.now()
    const moveTo = async () => {
      const response = JSON.parse(await browser(['get', 'box', target, '--json'])) as {
        data: { x: number; y: number; width: number; height: number }
      }
      const box = response.data
      await browser([
        'mouse',
        'move',
        String(Math.round(box.x + box.width / 2)),
        String(Math.round(box.y + box.height / 2)),
        '--human',
        '--duration',
        '600',
      ])
    }
    let output = ''
    try {
      if (action === 'hover') {
        await moveTo()
        await sleep(1000)
      } else if (action === 'click') output = await browser(['click', target, '--human'])
      else if (action === 'fill' || action === 'type') {
        const type = await browser(['get', 'attr', target, 'type'])
        const autocomplete = await browser(['get', 'attr', target, 'autocomplete'])
        if (/password|one-time-code|cc-/i.test(`${type} ${autocomplete}`))
          throw new Error('Sensitive fields cannot be typed into during recording')
        await browser(['click', target, '--human'])
        if (action === 'fill') {
          await browser(['press', process.platform === 'darwin' ? 'Meta+a' : 'Control+a'])
          await browser(['press', 'Backspace'])
        }
        for (const character of value) {
          await browser(['keyboard', 'type', character])
          await sleep(40)
        }
      } else if (action === 'move') {
        await browser(['mouse', 'move', ...value.split(','), '--human', '--duration', '600'])
        await sleep(1000)
      } else if (action === 'scroll') output = await browser(['scroll', value, '400'])
      else if (action === 'press') output = await browser(['press', value])
      else if (action === 'wait') output = await browser(['wait', target])
      else output = await browser(['snapshot'])
      return { output: output.slice(-16_000) }
    } finally {
      // Failed actions may have partially affected the browser. Preserve their
      // interval too; callers must inspect before deciding whether to retry.
      if (action !== 'snapshot')
        state.events.push({
          start: (started - state.startedAt) / 1000,
          end: (Date.now() - state.startedAt) / 1000,
        })
      await writeFile(join(directory, 'state.json'), JSON.stringify(state), { mode: 0o600 })
    }
  }
  if (request.operation !== 'stop') throw new Error('Unsupported recording operation')
  if (state.stoppedAt === undefined) {
    // Let Chromium paint and the recorder capture the last action's result.
    // A successful DOM snapshot can precede the next captured video frame.
    await sleep(1000)
    await browser(['record', 'stop'])
    state.stoppedAt = Date.now()
    await writeFile(join(directory, 'state.json'), JSON.stringify(state), { mode: 0o600 })
    await browser(['close'])
  }
  // Keep raw.mp4 and state on export failure, so stop can be retried safely.
  const raw = join(directory, 'raw.mp4')
  const probe = JSON.parse(
    await run(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', raw],
      directory,
    ),
  ) as { format: { duration: string } }
  const duration = Number(probe.format.duration)
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('The recording is empty')
  const intervals = mergeIntervals(
    state.events,
    duration,
    (state.stoppedAt - state.startedAt) / 1000,
  )
  const artifacts = join(state.cwd, '.dsh', 'artifacts', 'browser-recordings')
  let path = state.cwd
  for (const segment of ['.dsh', 'artifacts', 'browser-recordings', request.id]) {
    path = join(path, segment)
    await mkdir(path, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error
    })
    if (!(await lstat(path)).isDirectory())
      throw new Error('Artifact directories must not be symlinks')
  }
  const mp4 = join(artifacts, request.id, 'recording.mp4')
  const filter =
    intervals
      .map(
        (interval, index) =>
          `[0:v]trim=start=${interval.start}:end=${interval.end},setpts=PTS-STARTPTS[v${index}]`,
      )
      .join(';') +
    ';' +
    intervals.map((_, index) => `[v${index}]`).join('') +
    `concat=n=${intervals.length}:v=1:a=0[out]`
  await run(
    'ffmpeg',
    [
      '-y',
      '-loglevel',
      'error',
      '-i',
      raw,
      '-filter_complex',
      filter,
      '-map',
      '[out]',
      '-an',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      mp4,
    ],
    directory,
    60_000,
  )
  const compacted = intervals.reduce((sum, interval) => sum + interval.end - interval.start, 0)
  const loop = compacted <= 30 ? join(dirname(mp4), 'recording.loop.webp') : undefined
  if (loop)
    await run(
      'ffmpeg',
      [
        '-y',
        '-loglevel',
        'error',
        '-i',
        mp4,
        '-vf',
        'fps=20,scale=1280:-2:force_original_aspect_ratio=decrease',
        '-c:v',
        'libwebp_anim',
        '-quality',
        '75',
        '-loop',
        '0',
        '-an',
        loop,
      ],
      directory,
      60_000,
    )
  await rm(directory, { recursive: true, force: true })
  return { mp4, ...(loop ? { loop } : {}), durationSeconds: compacted, loopSkipped: !loop }
}

if (process.argv[1] === '-') {
  try {
    const result = await record(JSON.parse(process.argv[2] ?? '{}') as Request)
    process.stdout.write(JSON.stringify(result))
  } catch (error) {
    // Error diagnostics can contain page text. They are untrusted and bounded.
    process.stderr.write(error instanceof Error ? error.message.slice(-4096) : 'Recording failed')
    process.exitCode = 1
  }
}
