import * as React from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { Panel } from './panel.tsx'
import { createReader } from './reader.ts'
import { watchCapability } from './capability.ts'
import type { WorktreeClientContext } from './contracts.ts'
import { mountSessionClient } from './session-registration.tsx'
export default {
  name: 'local-worktrees',
  inject: ['slots', 'sessions', 'connection', 'jobs'],
  apply(ctx: WorktreeClientContext) {
    ctx.inject?.(['workspaces', 'uiWorkspace', 'conversation'], mountSessionClient)
    ctx.slots.inject('conversation.view', () => {
      // Cordis service reads create caller-scoped wrappers. Capture them for
      // this slot lifetime, not during render: composer updates must not
      // restart Panel's effect, reader, selection, or job subscription.
      const jobs = ctx.jobs
      const rpc = ctx.connection.rpc
      return watchCapability({
        sessions: ctx.sessions,
        rpc,
        register: (sessionId) => {
          // Own a public generation reference while our view definition exists.
          // Remove the definition while its native binding is still live, then
          // release after SlotCore's queued refresh has observed that removal.
          const reference = ctx.sessions.retain?.(sessionId as SessionId, { source: 'worktreeTab' })
          void reference?.ready.catch(() => {})
          const dispose = ctx.slots.register(
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
          )
          return () => {
            dispose()
            if (reference) queueMicrotask(() => reference.release())
          }
        },
      })
    })
  },
  createReader,
  watchCapability,
  Panel,
}
