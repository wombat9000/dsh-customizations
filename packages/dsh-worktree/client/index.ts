import * as React from 'react'
import { Panel } from './panel.tsx'
import { createReader } from './reader.ts'
import { watchCapability } from './capability.ts'
import type { WorktreeClientContext } from './contracts.ts'
export default {
  name: 'local-worktrees',
  inject: ['slots', 'sessions', 'connection', 'jobs'],
  apply(ctx: WorktreeClientContext) {
    ctx.slots.inject('conversation.view', () => {
      // Cordis service reads create caller-scoped wrappers. Capture them for
      // this slot lifetime, not during render: composer updates must not
      // restart Panel's effect, reader, selection, or job subscription.
      const jobs = ctx.jobs
      const rpc = ctx.connection.rpc
      return watchCapability({
        sessions: ctx.sessions,
        rpc,
        register: (sessionId) =>
          ctx.slots.register(
            {
              name: 'conversation.view',
              id: 'worktrees',
              order: 20,
              label: 'Worktrees',
              inject: (viewed) => ({ sessionId: viewed }),
            },
            (props) =>
              props.sessionId === sessionId
                ? React.createElement(Panel, {
                    key: sessionId,
                    sessionId,
                    jobs,
                    rpc,
                  })
                : null,
          ),
      })
    })
  },
  createReader,
  watchCapability,
  Panel,
}
