import type { ComponentType } from 'react'
import type {
  ClientRemote,
  ConnectionHandle,
  CredentialInfo,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { PluginConfigViewProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
export type { CredentialInfo }

export type Subscribe = (listener: () => void) => () => void
export interface SettingsProps {
  api: { credentials: Pick<ClientRemote['credentials'], 'describe' | 'set' | 'unset'> }
  subscribe: Subscribe
  view?: PluginConfigViewProps['view']
}
// Tool block metadata is an untrusted extension surface. Keep it unknown until
// the individual display field is checked, rather than asserting a host result.
export interface ToolBlock {
  kind?: string
  name?: string
  argsRaw?: unknown
  call?: { name?: string; argsRaw?: unknown }
  content?: unknown
  meta?: unknown
  isError?: boolean
  error?: { message?: unknown }
  result?: { error?: { message?: unknown } }
  message?: unknown
}
export type Progress = Record<string, unknown>
export interface Chunk {
  id?: string | number
  index?: number
  startSeconds: number
  endSeconds: number
  status: string
}
export interface ProgressRequest {
  callId: string
}
// Specialize only our consumed endpoint; the carrier still owns its result
// envelope, and the untrusted payload is narrowed before display.
export interface ProgressRpc {
  call(
    channel: '/youtube-transcript-progress',
    endpoint: 'get',
    payload: ProgressRequest,
  ): ReturnType<ConnectionHandle['rpc']['call']>
}
export interface ToolCardProps {
  block?: ToolBlock
  callId: string
  inspect?: () => void
  rpc?: ProgressRpc
  toolName?: string
}
// Narrow seat adapter: these two keyed seats supply different owner props.
// The credential Remote and Connection transport use their published RC2 types.
export interface RegistrationContext {
  get(name: 'connection'): Pick<ConnectionHandle, 'rpc'>
  remote: Pick<ClientRemote, 'credentials' | '$on'>
  on(event: 'connection/reset', listener: () => void): () => void
  slots: {
    inject(name: 'plugins.row.config' | 'tool.call.toolview', callback: () => () => void): unknown
    register(
      options: {
        name: 'plugins.row.config'
        key: string
        order: number
        inject: () => Pick<SettingsProps, 'api' | 'subscribe'>
      },
      component: ComponentType<SettingsProps>,
    ): () => void
    register(
      options: {
        name: 'tool.call.toolview'
        key: string
        locale: 'conversation'
        inject: () => Pick<ToolCardProps, 'rpc'>
      },
      component: ComponentType<ToolCardProps>,
    ): () => void
  }
}
