import { homedir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-shell'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import s from '@deepseek-ai/schemastery'
import type {
  SessionEnvironmentRequest,
  SessionEnvironmentSnapshot,
  SessionCIRequest,
  SessionCISnapshot,
} from './types.js'
import { CI_CHECKOUT_COMMAND, probeCheckout, readSessionCI } from './ci-host.js'
import type { CIHost } from './ci-host.js'
import {
  DEFAULT_STDOUT_MAX_BYTES,
  DEFAULT_TIMEOUT_MS,
  GIT_ENVIRONMENT_COMMAND,
  parseGitEnvironmentResult,
  unavailableSnapshot,
} from './git.js'

export * from './git.js'
export * from './types.js'

export const name = 'session-environment'

export interface Config {
  readonly timeoutMs?: number
  readonly stdoutMaxBytes?: number
}

export interface ResolvedConfig {
  readonly timeoutMs: number
  readonly stdoutMaxBytes: number
}

export const Config = s.object({
  timeoutMs: s.number().step(1).min(1).default(DEFAULT_TIMEOUT_MS),
  stdoutMaxBytes: s.number().step(1).min(1).default(DEFAULT_STDOUT_MAX_BYTES),
})

export function resolveConfig(config: Config = {}): ResolvedConfig {
  const resolved = {
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    stdoutMaxBytes: config.stdoutMaxBytes ?? DEFAULT_STDOUT_MAX_BYTES,
  }
  for (const key of ['timeoutMs', 'stdoutMaxBytes'] as const) {
    if (!Number.isSafeInteger(resolved[key]) || resolved[key] < 1) {
      throw new TypeError(`session-environment: ${key} must be a positive safe integer`)
    }
  }
  return resolved
}

function ciHost(ctx: Context, config: ResolvedConfig): CIHost {
  return {
    sessions: ctx.sessions,
    async probe(cwd, signal) {
      const execution = await ctx.shell.execute(
        ctx.shell.resolve({
          command: CI_CHECKOUT_COMMAND,
          workdir: cwd,
          signal,
          timeoutMs: config.timeoutMs,
          stdoutMaxBytes: 65536,
        }),
      )
      const result = await execution.result()
      return result.exitCode === 0 &&
        !result.timedOut &&
        !result.aborted &&
        !result.stdout.truncated
        ? result.stdout.text
        : null
    },
    github() {
      const service: unknown = ctx.get('localGitHubLiveCI')
      return service !== null &&
        typeof service === 'object' &&
        typeof Reflect.get(service, 'readCheckout') === 'function'
        ? (service as ReturnType<CIHost['github']>)
        : undefined
    },
  }
}

export async function readSessionEnvironment(
  ctx: Context,
  request: SessionEnvironmentRequest,
  config: ResolvedConfig,
  signal: AbortSignal,
): Promise<SessionEnvironmentSnapshot> {
  const home = homedir()
  const session = ctx.sessions.get(request.sessionId)
  const cwd = typeof session?.header.cwd === 'string' ? session.header.cwd : null
  if (!cwd) return unavailableSnapshot(null, home, 'Session working directory is unavailable')

  // Bracket local Git sampling with checkout identity when CI is available.
  // Optional integration/probe failures still leave ordinary Git reads usable.
  const host = ciHost(ctx, config)
  let before: Awaited<ReturnType<typeof probeCheckout>> | undefined
  try {
    if (host.github()) before = await probeCheckout(host, request.sessionId, signal)
  } catch {
    /* Local Environment remains available without a CI identity. */
  }

  try {
    const spec = ctx.shell.resolve({
      command: GIT_ENVIRONMENT_COMMAND,
      workdir: cwd,
      timeoutMs: config.timeoutMs,
      stdoutMaxBytes: config.stdoutMaxBytes,
      signal,
    })
    const execution = await ctx.shell.execute(spec)
    const result = await execution.result()
    const snapshot = parseGitEnvironmentResult({ cwd, home, result })
    if (snapshot.repo !== true || !before) return snapshot
    // Identity probes remain local/fetch-free. Never pair an older displayed
    // branch with a checkout key sampled after a branch/session/CWD change.
    try {
      const identity = await probeCheckout(host, request.sessionId, signal)
      if (!identity) return snapshot
      const sameBranch =
        snapshot.hasHead !== true ||
        (identity.checkout.branch === null
          ? Boolean(snapshot.branch && identity.checkout.head?.startsWith(snapshot.branch))
          : snapshot.branch === identity.checkout.branch)
      if (
        before.key !== identity.key ||
        !sameBranch ||
        ctx.sessions.get(request.sessionId) !== session
      )
        return unavailableSnapshot(cwd, home, 'Checkout changed; checking again')
      return { ...snapshot, checkoutKey: identity.key }
    } catch {
      return snapshot
    }
  } catch {
    if (signal.aborted) return unavailableSnapshot(cwd, home, 'Git check cancelled')
    return unavailableSnapshot(cwd, home, 'Unable to read Git state')
  }
}

export class SessionEnvironmentService extends TypertRemoteService {
  static inject = ['sessions', 'shell']
  static Config = Config

  readonly config: ResolvedConfig
  private readonly lifetime = new AbortController()

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'sessionEnvironment')
    this.config = resolveConfig(config)
    ctx.effect(() => () => this.lifetime.abort())
  }

  async read(
    request: SessionEnvironmentRequest,
    signal: AbortSignal,
  ): Promise<SessionEnvironmentSnapshot> {
    return readSessionEnvironment(
      this.ctx,
      request,
      this.config,
      AbortSignal.any([signal, this.lifetime.signal]),
    )
  }

  readCI(request: SessionCIRequest, signal: AbortSignal): Promise<SessionCISnapshot> {
    return readSessionCI(
      ciHost(this.ctx, this.config),
      request,
      AbortSignal.any([signal, this.lifetime.signal]),
    )
  }
}

export default SessionEnvironmentService
