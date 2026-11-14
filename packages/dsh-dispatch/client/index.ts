import type { ComponentType } from 'react'
import React from 'react'
import { DISPATCH_CHANNEL, STATUS_TOOLS } from '../shared/contracts.js'
import type { RpcEndpoints, RpcResult } from '../shared/contracts.js'
import { ProposalCard, ProposalView, validStatus } from './card.js'
import type { Request } from './card.js'
import { WorkersCard, WorkersView } from './workers.js'
import { ProposalTurnTail } from './turn-tail.js'
import type { TurnTailProps } from './turn-tail.js'
import { SidebarRoleIcon, SidebarRoleHover } from './sidebar-role.js'
import type { SidebarRoleProps } from './sidebar-role.js'

interface ClientContext {
  get?(name: string): unknown
  slots: {
    inject(name: string, callback: () => unknown): unknown
    register<P>(
      seat:
        | { name: 'tool.call.toolview'; key: string }
        | {
            name:
              | 'conversation.chat.turnTail'
              | 'sidebar.session.row.trailing'
              | 'sidebar.session.row.hover'
            id: string
          },
      component: ComponentType<P>,
    ): unknown
  }
  connection: {
    rpc: {
      call(
        channel: string,
        endpoint: string,
        input: unknown,
        signal?: AbortSignal,
      ): Promise<RpcResult<unknown>>
    }
  }
}

export function createRequest(ctx: ClientContext): Request {
  return async <E extends keyof RpcEndpoints>(
    endpoint: E,
    input: RpcEndpoints[E]['input'],
    signal?: AbortSignal,
  ) => {
    const result = await ctx.connection.rpc.call(DISPATCH_CHANNEL, endpoint, input, signal)
    if (!result.ok) throw new Error(result.error.message)
    // The card validates the shape before offering any decision.
    return result.value as RpcEndpoints[E]['result']
  }
}

export default {
  inject: ['slots', 'connection'],
  ProposalCard,
  ProposalView,
  WorkersCard,
  WorkersView,
  validStatus,
  apply(ctx: ClientContext) {
    ctx.slots.inject('sidebar.session.row.trailing', () =>
      ctx.slots.register<SidebarRoleProps>(
        { name: 'sidebar.session.row.trailing', id: 'local-dispatch-role' },
        SidebarRoleIcon,
      ),
    )
    ctx.slots.inject('sidebar.session.row.hover', () =>
      ctx.slots.register<SidebarRoleProps>(
        { name: 'sidebar.session.row.hover', id: 'local-dispatch-role' },
        SidebarRoleHover,
      ),
    )
    const request = createRequest(ctx)
    // Native Session navigation when the workspace UI is mounted; otherwise no control.
    const workspace = () =>
      ctx.get?.('uiWorkspace') as { openSession(sessionId: string): void } | undefined
    const openSession = (sessionId: string) => workspace()?.openSession(sessionId)
    const navigation = () => (workspace() ? openSession : undefined)
    // The completed-turn footer is the only approval surface; native tool
    // output stays read-only while the coordinator is running.
    function TurnTail(props: TurnTailProps) {
      return React.createElement(ProposalTurnTail, { ...props, request, openSession: navigation() })
    }
    ctx.slots.inject('conversation.chat.turnTail', () =>
      ctx.slots.register<TurnTailProps>(
        { name: 'conversation.chat.turnTail', id: 'local-dispatch-approvals' },
        TurnTail,
      ),
    )
    function Workers(props: { sessionId: string }) {
      return React.createElement(WorkersCard, {
        sessionId: props.sessionId,
        request,
        openSession: navigation(),
      })
    }
    for (const key of STATUS_TOOLS)
      ctx.slots.inject('tool.call.toolview', () =>
        ctx.slots.register<{ sessionId: string }>({ name: 'tool.call.toolview', key }, Workers),
      )
  },
}
