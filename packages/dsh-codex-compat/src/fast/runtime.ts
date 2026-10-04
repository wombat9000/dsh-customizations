import type { Context } from '@deepseek-ai/cordis'
import { isAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-settings'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { CodexFastBridge, FastBridgeError, supportsFast } from './bridge.js'
import { CHANNEL, isObject } from '../../shared/contracts.js'
import type { FastStatus, IntegrationStatus } from '../../shared/contracts.js'

const record = z
  .object({
    provider: z.literal('openai-codex'),
    model: z.string(),
    enabled: z.boolean(),
    revision: z.number().int().nonnegative(),
  })
  .strict()
const spec = defineDomain({
  name: 'local_codex_fast',
  version: 1,
  global: {
    schema: z.object({ enabled: z.boolean(), revision: z.number().int().nonnegative() }).strict(),
    initial: { enabled: true, revision: 0 },
  },
  tables: { sessions: domainTable<string, z.infer<typeof record>>(record) },
})
class UserError extends Error {}
const fail = (message: string): never => {
  throw new UserError(message)
}
const identity = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value)
const revision = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
function input(value: unknown, fields: string[]): Record<string, unknown> {
  if (!isObject(value) || Object.keys(value).sort().join(',') !== [...fields].sort().join(','))
    return fail('Invalid Codex Fast request.')
  return value
}

/** Owns durable policy, user-only changes, request eligibility and the reversible bridge. */
export class CodexFastRuntime {
  private active = true
  private forceOff = false
  private offEpoch = 0
  private readonly bridge: CodexFastBridge
  private writes: Promise<unknown> = Promise.resolve()
  private readonly observations = new Map<string, { model: string; kind: 'requested' | 'error' }>()
  private readonly sessionOff = new Set<string>()
  private readonly sessionEpoch = new Map<string, number>()
  private readonly ctx: Context
  private readonly domain: Domain<typeof spec> | null
  constructor(ctx: Context, domain: Domain<typeof spec> | null) {
    this.ctx = ctx
    this.domain = domain
    this.bridge = new CodexFastBridge(ctx.llm)
    this.bridge.observe()
  }
  observeAdapters() {
    this.bridge.observe()
  }
  private enabled() {
    return this.active && !!this.domain?.global.get().enabled && !this.forceOff
  }
  private guard() {
    if (!this.active) fail('Codex Fast plugin has stopped.')
  }
  private async queued<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writes
      .catch(() => undefined)
      .then(() => {
        this.guard()
        return operation()
      })
    this.writes = result
    return result
  }
  integrationStatus(): IntegrationStatus {
    const global = this.domain?.global.get() ?? { enabled: false, revision: 0 }
    let error: string | null = this.domain
      ? null
      : 'Fast settings storage is unavailable. Standard inference is unchanged.'
    let available = false
    if (this.enabled()) {
      try {
        this.bridge.enable()
        available = this.bridge.check()
      } catch {
        error =
          'Fast bridge is unavailable. Standard inference is unchanged while Fast is off. Disable the integration to recover a session that requests Fast.'
      }
    }
    return { enabled: this.enabled(), revision: global.revision, available, error }
  }
  private selection(sessionId: string) {
    const agent = this.ctx.agents.get(SessionId(sessionId))
    if (!agent) return fail('Open this session in DSH before changing Fast mode.')
    if (
      agent.session.header.origin === 'subagent' ||
      (agent.session.header.delegationDepth ?? 0) > 0
    )
      return fail('Fast mode is only available for top-level sessions.')
    const projected = this.ctx.sessionProjections.stateOf(agent.session, 'modelSelection')
    const selected =
      projected?.pending ?? projected?.lastUsed ?? this.ctx.agentDefaultModel.currentSelection()
    return { agent, provider: selected.provider, model: selected.model }
  }
  sessionStatus(sessionId: string): FastStatus {
    this.guard()
    const selected = this.selection(sessionId)
    const saved = this.domain?.table('sessions').get(sessionId)
    const requested =
      !this.sessionOff.has(sessionId) &&
      saved?.enabled === true &&
      saved.provider === selected.provider &&
      saved.model === selected.model
    const observed = this.observations.get(sessionId)
    const integration = this.integrationStatus()
    const supported = this.bridge.supports(selected.provider, selected.model)
    return {
      ...integration,
      sessionId,
      provider: selected.provider,
      model: selected.model,
      requested,
      supported,
      sessionRevision: saved?.revision ?? 0,
      observation: observed && observed.model === selected.model ? observed.kind : 'none',
      notice: !supported
        ? 'This provider/model is not on the reviewed Codex Fast allowlist.'
        : observed?.kind === 'requested' && observed.model === selected.model
          ? 'Fast was requested. The pi-ai stream does not expose server confirmation of the effective tier.'
          : null,
    }
  }
  /** Only ordinary LOOP requests in the exact opted-in top-level session qualify. */
  stream(
    options: GenerateOptions,
    next: () => AsyncIterable<import('@deepseek-ai/dsh-llm').StreamChunk>,
  ) {
    const saved =
      options.sessionId === undefined
        ? undefined
        : this.domain?.table('sessions').get(String(options.sessionId))
    const agent =
      options.sessionId === undefined ? undefined : this.ctx.agents.get(options.sessionId)
    const target =
      this.enabled() &&
      !this.sessionOff.has(String(options.sessionId)) &&
      isAgentLoopRequest(options) &&
      options.purpose === undefined &&
      supportsFast(options.provider, options.model) &&
      agent?.session.header.origin !== 'subagent' &&
      (agent?.session.header.delegationDepth ?? 0) === 0 &&
      !!agent &&
      saved?.enabled === true &&
      saved.model === options.model &&
      saved.provider === options.provider
    if (!target) return this.bridge.stream(options, next, null)
    try {
      this.bridge.enable()
    } catch {
      this.observations.set(String(options.sessionId), { model: options.model, kind: 'error' })
      throw new FastBridgeError()
    }
    const sessionId = String(options.sessionId)
    const runtime = this
    const live = () =>
      runtime.enabled() &&
      !runtime.sessionOff.has(sessionId) &&
      runtime.domain?.table('sessions').get(sessionId) === saved
    const stream = this.bridge.stream(options, next, {
      live,
      report() {
        if (live()) runtime.observations.set(sessionId, { model: options.model, kind: 'requested' })
      },
    })
    return (async function* () {
      try {
        yield* stream
      } catch (error) {
        if (live()) runtime.observations.set(sessionId, { model: options.model, kind: 'error' })
        throw error
      }
    })()
  }
  async rpc(endpoint: string, raw: unknown, signal: AbortSignal) {
    try {
      this.guard()
      if (endpoint === 'integration-status') {
        input(raw, [])
        return { ok: true as const, value: this.integrationStatus() }
      }
      if (endpoint === 'session-status') {
        const value = input(raw, ['sessionId'])
        if (!identity(value.sessionId)) fail('Invalid session identity.')
        return { ok: true as const, value: this.sessionStatus(value.sessionId as string) }
      }
      if (endpoint === 'integration-set') {
        const value = input(raw, ['enabled', 'revision'])
        if (typeof value.enabled !== 'boolean' || !revision(value.revision))
          fail('Invalid integration setting.')
        // Emergency off revokes pending payload callbacks immediately, even while storage is busy.
        if (value.enabled === false) {
          this.forceOff = true
          this.offEpoch++
          this.bridge.disable()
        }
        const offEpoch = this.offEpoch
        return {
          ok: true as const,
          value: await this.queued(async () => {
            if (!this.domain) throw new UserError('Fast settings storage is unavailable.')
            if (signal.aborted) fail('Fast settings change was cancelled.')
            const global = this.domain.global.get()
            if (
              value.enabled === true &&
              (global.revision !== value.revision || offEpoch !== this.offEpoch)
            )
              fail('Fast settings changed. Refresh before trying again.')
            if (value.enabled === true) this.bridge.enable()
            await this.domain.global.set({
              enabled: value.enabled as boolean,
              revision: global.revision + 1,
            })
            if (!this.active) {
              this.bridge.disable()
              fail('Codex Fast plugin has stopped.')
            }
            if (offEpoch === this.offEpoch) this.forceOff = false
            return this.integrationStatus()
          }),
        }
      }
      if (endpoint !== 'session-set') fail('Unknown Codex Fast operation.')
      const value = input(raw, ['sessionId', 'provider', 'model', 'enabled', 'revision'])
      if (
        !identity(value.sessionId) ||
        !identity(value.model) ||
        value.provider !== 'openai-codex' ||
        typeof value.enabled !== 'boolean' ||
        !revision(value.revision)
      )
        fail('Invalid session setting.')
      const sessionId = value.sessionId as string
      this.selection(sessionId)
      if (value.enabled === false) {
        this.sessionOff.add(sessionId)
        this.sessionEpoch.set(sessionId, (this.sessionEpoch.get(sessionId) ?? 0) + 1)
      }
      const sessionEpoch = this.sessionEpoch.get(sessionId) ?? 0
      return {
        ok: true as const,
        value: await this.queued(async () => {
          if (!this.domain) throw new UserError('Fast settings storage is unavailable.')
          if (signal.aborted) fail('Fast settings change was cancelled.')
          const status = this.sessionStatus(sessionId)
          if (
            value.enabled === true &&
            (status.provider !== value.provider ||
              status.model !== value.model ||
              status.sessionRevision !== value.revision ||
              sessionEpoch !== (this.sessionEpoch.get(sessionId) ?? 0))
          )
            fail('The session model or Fast setting changed. Refresh before trying again.')
          if (value.enabled === true && (!status.enabled || !status.available || !status.supported))
            fail('Enable the Fast integration and select a supported Codex model first.')
          await this.domain.table('sessions').put(value.sessionId as string, {
            provider: 'openai-codex',
            model: value.model as string,
            enabled: value.enabled as boolean,
            revision: status.sessionRevision + 1,
          })
          if (sessionEpoch === (this.sessionEpoch.get(sessionId) ?? 0))
            this.sessionOff.delete(sessionId)
          this.observations.delete(sessionId)
          return this.sessionStatus(sessionId)
        }),
      }
    } catch (error) {
      return {
        ok: false as const,
        error: {
          code: 'codex-fast/unavailable',
          message:
            error instanceof UserError || error instanceof FastBridgeError
              ? error.message
              : 'Codex Fast settings could not be updated. Disable the integration or refresh and try again.',
          details: {},
        },
      }
    }
  }
  async dispose() {
    this.active = false
    this.bridge.disable()
    await this.writes.catch(() => undefined)
    await this.domain?.close()
  }
}

export async function mountCodexFast(ctx: Context) {
  // Storage failure must not remove the recovery UI or affect the OAuth/provider plugin.
  let domain: Domain<typeof spec> | null = null
  try {
    domain = await ctx.storageDomain.open(spec)
  } catch {
    ctx.logger.warn('Codex Fast storage is unavailable; Standard inference remains unchanged.')
  }
  const runtime = new CodexFastRuntime(ctx, domain)
  ctx.effect(() => () => runtime.dispose())
  ctx.effect(() =>
    ctx.connection.rpc.handle(CHANNEL, (endpoint, payload, signal) =>
      runtime.rpc(endpoint, payload, signal),
    ),
  )
  ctx.effect(() => ctx.on('llm/stream', (options, next) => runtime.stream(options, next)))
  ctx.effect(() => ctx.on('llm/adapters-updated', () => runtime.observeAdapters()))
  ctx.effect(() => ctx.settings.configure({ auto: false }, ctx.fiber))
  return runtime
}
