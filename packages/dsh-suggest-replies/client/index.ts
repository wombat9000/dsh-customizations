import type { ComponentType } from 'react'
import { Replies, type ReplyProps } from './replies.tsx'

export const inject = ['slots']

// Additive session list, verified against DSH 0.2.1-rc.5: returning null
// removes only our row. Native composer controls and other docks remain intact.
interface ClientContext {
  slots: {
    inject(name: 'conversation.input.dock', register: () => unknown): unknown
    register(
      options: {
        name: 'conversation.input.dock'
        id: string
        order: number
      },
      component: ComponentType<ReplyProps>,
    ): () => void
  }
}

export function apply(ctx: ClientContext) {
  ctx.slots.inject('conversation.input.dock', () =>
    ctx.slots.register(
      {
        name: 'conversation.input.dock',
        id: 'local-suggest-replies',
        order: 20,
      },
      Replies,
    ),
  )
}
