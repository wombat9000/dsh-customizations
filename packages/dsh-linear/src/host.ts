import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type { LinearSettings } from './contracts.js'
import type { RpcResult, ConnectionStatus } from '../shared/rpc.js'

export type LinearContext = Context & {
  fiber: Context['fiber'] & { entry?: { options: { id: string } } }
}
export interface VolatileSettings {
  organizationId: { get(): string }
  organizationName: { get(): string }
  organizationUrlKey: { get(): string }
}
export interface HostConfig extends VolatileSettings {
  apiKey?: string
  maxDescriptionChars?: number
  maxCommentChars?: number
  timeoutMs?: number
}
export interface ToolConfig {
  timeoutMs: number
}
// The pinned host supplies this generic channel; only the consumed RPC surface
// is represented here. Incoming payloads remain unknown until endpoint validation.
export interface SettingsConnection {
  rpc: {
    handle(
      channel: string,
      callback: (
        endpoint: string,
        payload: unknown,
        signal: AbortSignal,
      ) => Promise<RpcResult<ConnectionStatus>>,
      options: { authority: 'trusted-host' },
    ): () => Promise<void>
  }
}
export type SettingsReader = () => LinearSettings
