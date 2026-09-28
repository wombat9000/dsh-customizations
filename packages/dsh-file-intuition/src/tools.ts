import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-fs'
import { defineTool, type ToolExecutionToken, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { LIMITS, type JevService, type PreparedScan, type ScoutResult } from './contracts.js'
import { collectFiles } from './files.js'
import { parseRequest, prepareScan, evaluateScan } from './engine.js'
import { DESCRIPTIONS, OUTPUT, PARAMETERS, type ScoutToolName } from './schemas.js'

const MAX_PENDING = 8
const isJev = (value: unknown): value is JevService =>
  value !== null &&
  typeof value === 'object' &&
  'settings' in value &&
  typeof value.settings === 'function' &&
  'evaluate' in value &&
  typeof value.evaluate === 'function'
const isTool = (name: string): name is ScoutToolName => Object.hasOwn(PARAMETERS, name)

interface Pending {
  name: ScoutToolName
  agent: NonNullable<ToolRunContext['agent']>
  session: NonNullable<ToolRunContext['agent']>['session']
  cwd: string
  requestKey: string
  jev: JevService
  signal: AbortSignal
  prepared?: PreparedScan
  release(): void
}

export function registerScoutTools(ctx: Context): void {
  // Preset mounts are shared across agents. Never store a closure-global cwd or request state.
  const pending = new Map<ToolExecutionToken, Pending>()
  const lifecycle = new AbortController()
  let active = true
  ctx.effect(
    () => () => {
      active = false
      lifecycle.abort()
      for (const entry of pending.values()) entry.release()
      pending.clear()
    },
    'file-intuition: release prepared snapshots',
  )

  ctx.on('tools/pre-execute', async (exec, next) => {
    if (!isTool(exec.name)) return next()
    if (
      !active ||
      !exec.agent ||
      !exec.token ||
      pending.has(exec.token) ||
      pending.size >= MAX_PENDING
    ) {
      return {
        kind: 'deny',
        reason:
          'File Intuition preparation is unavailable, duplicated, or at its bounded concurrency limit.',
      }
    }
    const cwd = exec.agent.session.header.cwd
    if (typeof cwd !== 'string' || !cwd)
      return {
        kind: 'deny',
        reason: 'File Intuition requires a calling session with an explicit workspace.',
      }
    const jev: unknown = ctx.get('jev')
    if (!isJev(jev))
      return {
        kind: 'deny',
        reason:
          'The shared Jev service is unavailable. Configure the existing OpenRouter and Jev plugins; File Intuition never creates a replacement provider.',
      }
    const request = parseRequest(exec.name, exec.arguments)
    const deadline = new AbortController()
    const signal = AbortSignal.any([exec.signal, lifecycle.signal, deadline.signal])
    const token = exec.token
    const timer = setTimeout(() => deadline.abort(), LIMITS.timeoutMs)
    timer.unref()
    const entry: Pending = {
      name: exec.name,
      agent: exec.agent,
      session: exec.agent.session,
      cwd,
      requestKey: JSON.stringify(request),
      jev,
      signal,
      release() {
        clearTimeout(timer)
        signal.removeEventListener('abort', entry.release)
        if (pending.get(token) === entry) pending.delete(token)
        delete entry.prepared
      },
    }
    pending.set(token, entry)
    signal.addEventListener('abort', entry.release, { once: true })
    try {
      if (signal.aborted) throw new Error('File Intuition preparation cancelled.')
      const discovery = await collectFiles(ctx.fs, cwd, request, signal)
      entry.prepared = prepareScan(request, jev.settings().model, discovery)
      const downstream = await next()
      if (downstream.kind === 'deny' || downstream.kind === 'cancel') {
        entry.release()
        return downstream
      }
      if (!active || signal.aborted || pending.get(token) !== entry) {
        entry.release()
        return {
          kind: 'deny',
          reason: 'File Intuition snapshot expired or was cancelled. Nothing was sent.',
        }
      }
      // File Intuition adds no human approval gate. Other DSH policies keep their
      // decisions, including asks, localized disclosures, denials and cancellation.
      return downstream
    } catch {
      entry.release()
      return {
        kind: 'deny',
        reason:
          'File Intuition could not prepare a safe bounded snapshot. Check relative paths, supported patterns, exclusions, limits and Jev configuration. No file content was sent.',
      }
    }
  })
  ctx.on('tools/result', (exec) => {
    pending.get(exec.token)?.release()
  })

  async function execute(
    name: ScoutToolName,
    args: unknown,
    exec: ToolRunContext,
  ): Promise<ScoutResult> {
    const entry = pending.get(exec.token)
    if (
      !entry ||
      !entry.prepared ||
      !active ||
      entry.signal.aborted ||
      entry.name !== name ||
      entry.agent !== exec.agent ||
      entry.session !== exec.agent?.session ||
      entry.cwd !== exec.agent?.session.header.cwd ||
      ctx.get('jev') !== entry.jev ||
      JSON.stringify(parseRequest(name, args)) !== entry.requestKey ||
      JSON.stringify(parseRequest(name, exec.arguments)) !== entry.requestKey
    ) {
      entry?.release()
      throw new Error(
        'File Intuition requires an unused preparation for this exact caller, workspace, query, model and file snapshot.',
      )
    }
    const scan = entry.prepared
    // Consume before any await. A replay cannot reuse the same execution token.
    pending.delete(exec.token)
    delete entry.prepared
    try {
      return await evaluateScan(scan, entry.jev, entry.signal)
    } finally {
      entry.release()
    }
  }
  for (const name of Object.keys(PARAMETERS).filter(isTool)) {
    ctx.tools.register(
      defineTool({
        name,
        description: DESCRIPTIONS[name],
        parameters: PARAMETERS[name],
        output: {
          schema: OUTPUT,
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        },
        timeoutMs: LIMITS.timeoutMs,
        isConcurrencySafe: () => false,
        execute: (args, exec) => execute(name, args, exec),
        presentCall: (args) => ({
          card: 'generic',
          title: name,
          kind: 'read',
          rawInput: JSON.stringify(args),
        }),
      }),
    )
  }
}
