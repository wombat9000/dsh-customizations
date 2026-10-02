import type { SkillRegistry } from '@deepseek-ai/dsh-skill'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { ToolRuntime } from '@deepseek-ai/dsh-tools'
import type { StatusResponse, TrivyStatus } from '../shared/contracts.js'

export type TrivySubprocess = Pick<SubprocessRuntime, 'resolveExecutable' | 'spawn'>
export interface CheckOptions {
  force?: boolean
  signal?: AbortSignal | undefined
}
export interface TrivyRuntime {
  check(options?: CheckOptions): Promise<TrivyStatus>
  clear(): void
}
export interface ScanExecution {
  signal?: AbortSignal | undefined
  agent?: { session: { header: { cwd?: string | undefined } } } | undefined
}

// Narrow consumed host surface: Web services remain optional in a headless host.
export interface StatusContext {
  get(name: 'connection'):
    | {
        rpc: {
          handle(
            channel: string,
            handler: (
              endpoint: string,
              payload: unknown,
              signal: AbortSignal,
            ) => Promise<StatusResponse>,
            options: { authority: 'trusted-host' },
          ): () => void
        }
      }
    | undefined
  effect(setup: () => () => void, label: string): unknown
}
export interface TrivyContext {
  subprocess: TrivySubprocess
  tools: Pick<ToolRuntime, 'register'>
  skills: Pick<SkillRegistry, 'registerProvider'>
  inject(services: ['connection', 'webServer'], callback: (context: StatusContext) => void): unknown
}
