import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import React from 'react'
import { ShipItButton } from './button.tsx'
import type { ShipItProps } from './button.tsx'
import { SHIP_IT_PROMPT } from './prompt.ts'

export default {
  inject: ['slots', 'sessions', 'conversation'],
  apply(ctx: Context) {
    // DSH 0.2.1-rc.5: additive session-scoped list, ascending order, no owner
    // props. Returning null hides only our entry; native header controls remain.
    return ctx.slots.inject('conversation.session.header.utilities', () =>
      ctx.slots.register(
        {
          name: 'conversation.session.header.utilities',
          id: 'local-ship-it',
          order: 30,
          label: 'Ship it',
          inject: (sessionId) => ({
            hooks: { block: ctx.conversation.blocks.storeFor(sessionId) },
            send: async () => {
              const scope = ctx.sessions.scope(sessionId)
              const current = scope && ctx.sessions.sessionOf(scope)?.getSnapshot()
              // Borrowed session contexts require get(), as in DSH's QueueDock;
              // direct scope.conversation access has no Cordis injection grant.
              const conversation = scope?.get('conversation')
              if (
                !scope ||
                !current ||
                !conversation ||
                current.removed ||
                current.subagent !== null ||
                current.openState !== 'open' ||
                current.running ||
                current.pendingSubmissions.length > 0 ||
                ctx.conversation.blocks.storeFor(sessionId).getSnapshot()
              ) {
                throw new Error('Session is not available for shipping')
              }
              // Native admission and authorization, exactly one text block.
              // Unlike inputActions.setDraft/submit, this preserves the draft.
              await conversation.send(SHIP_IT_PROMPT)
            },
          }),
        },
        (props: ShipItProps) =>
          React.createElement(ShipItButton, { ...props, key: props.sessionId }),
      ),
    )
  },
}
