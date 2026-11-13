import { DispatchError } from './contracts.js'
import type { SessionLike } from './types.js'

/**
 * Git execution inside DSH's managed execution world (`ctx.subprocess`,
 * `ctx.sandbox`, `ctx.sandboxPolicy`, `ctx.fs`), mirroring the
 * `@deepseek-ai/dsh-experimental-worktree` 0.2.2-rc.3 runner: executable lookup
 * and process spawning belong to the mounted subprocess provider, every command
 * is confined under the calling Session's resolved sandbox policy, and paths
 * are canonicalized by the mounted filesystem provider. Dispatch never uses the
 * Host's own `child_process`, environment, or filesystem for repository work.
 */
export interface GitWorld {
  /** Label of the filesystem provider whose paths and keys these are. */
  provider(): string
  /**
   * Run one Git argv without a shell under `session`'s sandbox policy.
   * @throws DispatchError('unavailable') on a disallowed exit status, timeout, or missing services.
   */
  git(
    session: SessionLike | undefined,
    cwd: string,
    args: readonly string[],
    signal?: AbortSignal,
    allowedExitCodes?: readonly number[],
  ): Promise<{ stdout: string; exitCode: number }>
  /** Canonical process path and opaque provider key for one path in this world. */
  canonical(
    path: string,
    cwd?: string,
    signal?: AbortSignal,
  ): Promise<{ path: string; key: string }>
}

/** `ctx.subprocess` (dsh-subprocess 0.2.2-rc.3), consumed members only. */
export interface SubprocessLike {
  resolveExecutable(command: string, env?: undefined, signal?: AbortSignal): Promise<string>
  spawn(spec: {
    argv: readonly string[]
    cwd: string
    env?: Record<string, string | undefined>
    signal?: AbortSignal
    graceMs: number
    stdio: {
      stdin: 'ignore'
      stdout: { maxBytes: number }
      stderr: { maxBytes: number }
    }
  }): {
    readonly done: Promise<{ exitCode: number | null; signal: string | null }>
    readonly collected: {
      readonly stdout?: { readFrom(offset: number): { text: string; lossy: boolean } }
      readonly stderr?: { readFrom(offset: number): { text: string; lossy: boolean } }
    }
    terminate(): void
    waitForExit(signal?: AbortSignal): Promise<boolean>
  }
}

export interface SandboxPolicyValue {
  readonly mode: string
  readonly [key: string]: unknown
}

/** `ctx.sandboxPolicy` (dsh-sandbox-policy 0.2.2-rc.3). */
export interface SandboxPolicyLike {
  resolve(request?: { session?: SessionLike }): SandboxPolicyValue
}

/** `ctx.sandbox` (dsh-sandbox 0.2.2-rc.3). */
export interface SandboxLike {
  confine(
    argv: readonly string[],
    policy: SandboxPolicyValue,
    signal?: AbortSignal,
  ): Promise<{ argv: readonly string[] }>
}

/** `ctx.fs` (dsh-fs 0.2.2-rc.3), consumed members only. */
export interface FileSystemLike {
  resolve(
    path: string,
    opts?: { cwd?: string; signal?: AbortSignal },
  ): Promise<{ targetKey: string; displayPath: string }>
  processPath(target: { targetKey: string; displayPath: string }): string
}

export interface ExecutionServices {
  subprocess: SubprocessLike
  sandbox: SandboxLike
  sandboxPolicy: SandboxPolicyLike
  fs: FileSystemLike
}

export interface WorldConfig {
  gitCommand?: string
  timeoutMs?: number
  graceMs?: number
  maxOutputBytes?: number
}

// Repository-selecting variables from the Host must never redirect a command.
const GIT_ENV: Record<string, string | undefined> = Object.fromEntries(
  [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_COMMON_DIR',
    'GIT_INDEX_FILE',
    'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_CONFIG',
    'GIT_CONFIG_PARAMETERS',
    'GIT_CONFIG_COUNT',
    'GIT_CEILING_DIRECTORIES',
    'GIT_PREFIX',
    'GIT_SHALLOW_FILE',
    'GIT_GRAFT_FILE',
    'GIT_REPLACE_REF_BASE',
    'GIT_ATTR_SOURCE',
  ].map((key) => [key, undefined]),
)

export function managedWorld(
  services: () => Partial<ExecutionServices>,
  config: WorldConfig = {},
): GitWorld {
  const command = config.gitCommand ?? 'git'
  const timeoutMs = config.timeoutMs ?? 120_000
  const graceMs = config.graceMs ?? 3_000
  const maxBytes = config.maxOutputBytes ?? 1_048_576
  const require = (): ExecutionServices => {
    const value = services()
    if (!value.subprocess || !value.sandbox || !value.sandboxPolicy || !value.fs)
      throw new DispatchError(
        'unavailable',
        'DSH subprocess, sandbox, and filesystem services are required for repository work.',
      )
    return value as ExecutionServices
  }
  return {
    provider() {
      const fs = require().fs as object
      return (fs.constructor as { name?: string } | undefined)?.name || 'fs'
    },
    async canonical(path, cwd, signal) {
      const { fs } = require()
      const target = await fs.resolve(path, {
        ...(cwd ? { cwd } : {}),
        ...(signal ? { signal } : {}),
      })
      return { path: fs.processPath(target), key: String(target.targetKey) }
    },
    async git(session, cwd, args, signal, allowedExitCodes = [0]) {
      const { subprocess, sandbox, sandboxPolicy } = require()
      const deadline = AbortSignal.timeout(timeoutMs)
      const operation = signal ? AbortSignal.any([signal, deadline]) : deadline
      const policy = sandboxPolicy.resolve(session ? { session } : {})
      const argv = [await subprocess.resolveExecutable(command, undefined, operation), ...args]
      const wrapped =
        policy.mode === 'danger-full-access'
          ? argv
          : (await sandbox.confine(argv, policy, operation)).argv
      operation.throwIfAborted()
      const child = subprocess.spawn({
        argv: wrapped,
        cwd,
        env: {
          ...GIT_ENV,
          GIT_TERMINAL_PROMPT: '0',
          GIT_OPTIONAL_LOCKS: '0',
          GIT_NO_LAZY_FETCH: '1',
          LC_ALL: 'C',
        },
        signal: operation,
        graceMs,
        stdio: { stdin: 'ignore', stdout: { maxBytes }, stderr: { maxBytes } },
      })
      try {
        const outcome = await child.done
        if (deadline.aborted)
          throw new DispatchError('unavailable', `git ${args[0] ?? ''} timed out.`)
        operation.throwIfAborted()
        const stdout = child.collected.stdout?.readFrom(0) ?? { text: '', lossy: false }
        if (outcome.exitCode === null || !allowedExitCodes.includes(outcome.exitCode)) {
          const detail = (child.collected.stderr?.readFrom(0).text ?? '').trim().slice(0, 500)
          throw new DispatchError(
            'unavailable',
            `git ${args[0] ?? ''} failed (${outcome.signal ?? outcome.exitCode}): ${detail}`,
          )
        }
        if (stdout.lossy)
          throw new DispatchError('unavailable', `git ${args[0] ?? ''} output exceeded the limit.`)
        return { stdout: stdout.text, exitCode: outcome.exitCode }
      } finally {
        child.terminate()
        await child.waitForExit().catch(() => false)
      }
    },
  }
}
