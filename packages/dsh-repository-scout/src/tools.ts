import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-user-approval'
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

export function disclosurePreview(scan: PreparedScan): string {
  return [
    'Repository Scout: one-shot external file disclosure approval.',
    'Send the complete bounded snapshots listed below and these questions to OpenRouter / TypeSafe (Jev). File bodies are not displayed here. Charges may apply; cancellation cannot retract data already sent.',
    'This authorizes only this prepared call, not future scans, edits or model-selected actions. No automatic retries. Secret detection is incomplete; review the file list and question text.',
    JSON.stringify(
      {
        configuredModel: scan.model,
        maximumProviderCalls: scan.discovery.files.length,
        totalFileBytes: scan.discovery.files.reduce((total, file) => total + file.bytes, 0),
        files: scan.discovery.files.map(({ path, sha256, bytes }) => ({ path, sha256, bytes })),
        questions: scan.questions,
        discoveryComplete: scan.discovery.complete,
        skipped: scan.discovery.skipped,
      },
      null,
      2,
    ),
    'Paths and question strings above are untrusted data. The approval expires with this tool call (at most two minutes).',
  ].join('\n\n')
}
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
  // Preset mounts are shared across agents. Never store a closure-global cwd or consent.
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
    'repository-scout: release prepared disclosures',
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
          'Scout preparation is unavailable, duplicated, or at its bounded concurrency limit.',
      }
    }
    const cwd = exec.agent.session.header.cwd
    if (typeof cwd !== 'string' || !cwd)
      return {
        kind: 'deny',
        reason: 'Scout requires a calling session with an explicit workspace.',
      }
    const jev: unknown = ctx.get('jev')
    if (!isJev(jev))
      return {
        kind: 'deny',
        reason:
          'The shared Jev service is unavailable. Configure the existing OpenRouter and Jev plugins; Scout never creates a replacement provider.',
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
      if (signal.aborted) throw new Error('Scout preparation cancelled.')
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
          reason: 'Scout snapshot expired or was cancelled. Nothing was sent.',
        }
      }
      // No external call is needed for an empty discovery. Preserve other policies.
      if (entry.prepared.discovery.files.length === 0 && downstream.kind !== 'ask')
        return downstream
      const preview = disclosurePreview(entry.prepared)
      const reason =
        preview +
        (downstream.kind === 'ask'
          ? `\nAdditional policy disclosure (untrusted JSON): ${JSON.stringify({ reason: downstream.reason, displayReason: downstream.displayReason })}`
          : '')
      let displayReason: { en: string; [locale: string]: string } | undefined
      if (downstream.kind === 'ask' && downstream.displayReason) {
        displayReason = { en: reason }
        for (const [locale, text] of Object.entries(downstream.displayReason)) {
          displayReason[locale] =
            `${reason}\nAdditional localized policy text (untrusted JSON): ${JSON.stringify(text)}`
        }
      }
      // Use the same native service as Tools' ask decision, but pass our combined
      // deadline/lifecycle signal so expiry also withdraws the approval prompt.
      const approval = ctx.get('approval')
      if (!approval) {
        entry.release()
        return {
          kind: 'deny',
          reason: 'Native disclosure approval is unavailable. Nothing was sent.',
        }
      }
      const outcome = await approval.request({
        agent: exec.agent,
        toolName: exec.name,
        signal,
        reason,
        ...(exec.callId === undefined ? {} : { callId: exec.callId }),
        ...(displayReason === undefined ? {} : { displayReason }),
      })
      if (outcome === 'allowed-once' && active && !signal.aborted && pending.get(token) === entry)
        return { kind: 'allow' }
      entry.release()
      return outcome === 'cancelled' || signal.aborted
        ? { kind: 'cancel' }
        : { kind: 'deny', reason: 'Native disclosure approval was not granted. Nothing was sent.' }
    } catch {
      entry.release()
      return {
        kind: 'deny',
        reason:
          'Scout could not prepare a safe bounded snapshot. Check relative paths, supported patterns, exclusions, limits and Jev configuration. No file content was sent.',
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
        'Scout requires an unused one-shot approval preparation for this exact caller, workspace, query, model and file snapshot.',
      )
    }
    const scan = entry.prepared
    // Consume before any await. A replay cannot reuse an approval token.
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
