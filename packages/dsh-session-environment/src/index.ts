import { homedir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-shell'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import s from '@deepseek-ai/schemastery'
import type { SessionEnvironmentRequest, SessionEnvironmentSnapshot } from './types.js'
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

  try {
    const spec = ctx.shell.resolve({
      command: GIT_ENVIRONMENT_COMMAND,
      workdir: cwd,
      timeoutMs: config.timeoutMs,
      stdoutMaxBytes: config.stdoutMaxBytes,
      signal,
    })
    const result = await ctx.shell.run(spec)
    return parseGitEnvironmentResult({ cwd, home, result })
  } catch {
    if (signal.aborted) return unavailableSnapshot(cwd, home, 'Git check cancelled')
    return unavailableSnapshot(cwd, home, 'Unable to read Git state')
  }
}

export class SessionEnvironmentService extends TypertRemoteService {
  static inject = ['sessions', 'shell']
  static Config = Config

  readonly config: ResolvedConfig

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'sessionEnvironment')
    this.config = resolveConfig(config)
  }

  async read(request: SessionEnvironmentRequest, signal: AbortSignal): Promise<SessionEnvironmentSnapshot> {
    return readSessionEnvironment(this.ctx, request, this.config, signal)
  }
}

export default SessionEnvironmentService
