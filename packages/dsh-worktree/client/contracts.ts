import type { ComponentType } from 'react'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    worktreeTab: unknown
  }
}
import type { WorktreeRpc } from '../shared/contracts.ts'
import type { SessionClientContext } from './session-contracts.ts'
export interface Store<T> {
  getSnapshot(): T
  subscribe(callback: () => void): () => void
}
// Narrow consumed RC2 catalog, Jobs mirror, and composed slot contracts. These
// preserve the existing registrations and do not import host-only service types.
export interface Sessions {
  retain?: ISessions['retain']
  list: Store<{
    byId: Record<string, { id: string; retainedBy: Record<string, number | undefined> }>
  }>
}
export interface Jobs {
  watchRows(sessionId: string): () => void
  state: Store<{ rows: Record<string, unknown> }>
}
export interface PanelProps {
  rpc: WorktreeRpc
  jobs: Jobs
  sessionId: string
}
export interface CapabilityOptions {
  sessions: Sessions
  rpc: WorktreeRpc
  register(sessionId: string): () => void
  interval?: typeof setInterval
  clear?: typeof clearInterval
  document?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>
}
export interface WorktreeClientContext {
  // Optional service injection leaves the existing read-only panel fixtures and
  // hosts without Workspace UI unchanged. Session UI has its own typed face.
  inject?(services: string[], callback: (ctx: SessionClientContext) => void): unknown
  jobs: Jobs
  sessions: Sessions
  connection: { rpc: WorktreeRpc }
  slots: {
    inject(name: 'conversation.view', callback: () => () => void): unknown
    register(
      options: {
        name: 'conversation.view'
        id: 'worktrees'
        order: number
        label: string
        inject(sessionId: string): { sessionId: string }
      },
      component: ComponentType<{ sessionId: string }>,
    ): () => void
  }
}
