import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { ComposerBlocks } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ComponentType } from 'react'

// RC2 publishes SlotCore, but the Cordis SlotRegistry service wrapper is not
// exported by ui-slots. These are its consumed declaration/lifetime methods.
// Root main/sidebar/overlay seats match dsh-projects/client/registration.tsx.
export interface SessionClientContext {
  sessions: Pick<ISessions, 'list' | 'binding' | 'refresh'>
  workspaces: Pick<IWorkspaces, 'list' | 'create'>
  uiWorkspace: Pick<UiWorkspace, 'openSession' | 'archiveSession'>
  conversation: { blocks: ComposerBlocks }
  connection: {
    rpc: {
      call(
        channel: string,
        endpoint: string,
        input: unknown,
        signal?: AbortSignal,
      ): Promise<unknown>
    }
  }
  effect(callback: () => () => void): unknown
  slots: Pick<SlotCore, 'register' | 'entries' | 'subscribe'> & {
    inject(name: string, callback: () => unknown): unknown
  }
}
export interface ShellSeats {
  register(
    options: { name: 'sidebar.panellist'; id: string; order: number; label: string },
    component: ComponentType<{ size: number; active: boolean }>,
  ): () => void
  register(options: { name: 'main'; key: string }, component: ComponentType): () => void
  register(
    options: { name: 'shell.overlay'; id: string; order: number },
    component: ComponentType,
  ): () => void
}
export function shellSeats(ctx: SessionClientContext): ShellSeats {
  // These shell-owned declarations are not re-declared by this plugin. The
  // published ui-slots types only know declarations merged by loaded UI types.
  return ctx.slots as unknown as ShellSeats
}
