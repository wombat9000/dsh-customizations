import type { ComponentType } from 'react'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { ID, adaptRpc } from './rpc.ts'
import { createController } from './controller.ts'
import { RecapAction, RecapCard } from './containers/recap.tsx'
import type { RecapActionProps, RecapCardProps } from './containers/recap.tsx'
import { SettingsCard } from './containers/SettingsCard.tsx'
import type { SettingsCardProps } from './containers/SettingsCard.tsx'

// Keep the adapter limited to our three consumed seats. DSH 0.2.0-rc.2
// declares plugins.row.config as keyed/root with owner-supplied view; the
// conversation seats remain session lists. Owner props stay separate from inject.
interface RecapSlots {
  'conversation.input.dock': RecapCardProps
  'conversation.chat.assistant-actions': RecapActionProps
  'plugins.row.config': SettingsCardProps
}
type SessionSeat = 'conversation.input.dock' | 'conversation.chat.assistant-actions'
type Registration<K extends keyof RecapSlots> = K extends SessionSeat
  ? {
      name: K
      id: string
      order: number
      inject: (sessionId: string) => Pick<RecapSlots[K], 'sessionId' | 'controller'>
    }
  : {
      name: K
      key: string
      inject: () => Pick<SettingsCardProps, 'rpc' | 'controller'>
    }
export interface RecapRegistrationContext {
  get(name: 'connection'): Pick<ConnectionHandle, 'rpc'>
  get(name: 'remote'): {
    $on(event: 'api-session/activity', listener: (sessionId: string) => void): unknown
  }
  slots: {
    inject<K extends keyof RecapSlots>(name: K, register: () => unknown): unknown
    register<K extends keyof RecapSlots>(
      options: Registration<K>,
      component: ComponentType<RecapSlots[K]>,
    ): unknown
  }
}

export function apply(ctx: RecapRegistrationContext) {
  let storage: Storage | undefined
  try {
    storage = window.localStorage
  } catch {}
  const controller = createController({ rpc: adaptRpc(ctx.get('connection').rpc), storage })
  // DSH emits this only after a durable human-authored user/message.
  ctx
    .get('remote')
    .$on('api-session/activity', (sessionId) => controller.humanMessageSent(sessionId))
  ctx.slots.inject('conversation.input.dock', () =>
    ctx.slots.register<'conversation.input.dock'>(
      {
        name: 'conversation.input.dock',
        id: ID,
        order: 10,
        inject: (sessionId) => ({ sessionId, controller }),
      },
      RecapCard,
    ),
  )
  ctx.slots.inject('conversation.chat.assistant-actions', () =>
    ctx.slots.register<'conversation.chat.assistant-actions'>(
      {
        name: 'conversation.chat.assistant-actions',
        id: `${ID}-action`,
        order: 10,
        inject: (sessionId) => ({ sessionId, controller }),
      },
      RecapAction,
    ),
  )
  ctx.slots.inject('plugins.row.config', () =>
    ctx.slots.register<'plugins.row.config'>(
      {
        name: 'plugins.row.config',
        key: `@wombat9000/dsh-session-recap#${ID}`,
        inject: () => ({ rpc: adaptRpc(ctx.get('connection').rpc), controller }),
      },
      SettingsCard,
    ),
  )
}
