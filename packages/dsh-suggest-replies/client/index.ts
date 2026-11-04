import React, { type ComponentType } from 'react'
import { Replies, type ReplyProps } from './replies.tsx'

export const inject = ['slots', 'sessions', 'conversation']

interface Session {
  removed: boolean
  openState: string
  running: boolean
  pendingSubmissions: readonly unknown[]
}
interface BlockSource {
  subscribe(listener: () => void): () => void
  getSnapshot(): { reason: string } | undefined
}
// Consumed subsets of the pinned 0.2.1-rc.3 APIs, also used by Ship it.
// The additive dock list supports per-session inject; hooks.block supplies
// useBlock. Native admission/authorization remain authoritative.
interface ClientContext {
  sessions: {
    scope(
      sessionId: string,
    ): { get(name: 'conversation'): { send(text: string): Promise<void> } | undefined } | undefined
    sessionOf(scope: object): { getSnapshot(): Session } | undefined
  }
  conversation: { blocks: { storeFor(sessionId: string): BlockSource } }
  slots: {
    inject(name: 'conversation.input.dock', register: () => unknown): unknown
    register(
      options: {
        name: 'conversation.input.dock'
        id: string
        order: number
        inject(sessionId: string): {
          hooks: { block: BlockSource }
          send(reply: string): Promise<void>
        }
      },
      component: ComponentType<ReplyProps & { sessionId: string }>,
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
        inject: (sessionId) => ({
          hooks: { block: ctx.conversation.blocks.storeFor(sessionId) },
          send: async (reply) => {
            const scope = ctx.sessions.scope(sessionId)
            const current = scope && ctx.sessions.sessionOf(scope)?.getSnapshot()
            const conversation = scope?.get('conversation')
            if (
              !current ||
              !conversation ||
              current.removed ||
              current.openState !== 'open' ||
              current.running ||
              current.pendingSubmissions.length > 0 ||
              ctx.conversation.blocks.storeFor(sessionId).getSnapshot()
            )
              throw new Error('Session is not available for a suggested reply')
            // Do not call inputActions.submit/setDraft: those consume the draft.
            await conversation.send(reply)
          },
        }),
      },
      (props) => React.createElement(Replies, { ...props, key: props.sessionId }),
    ),
  )
}
