import type { ComponentType } from 'react'
import React from 'react'
import { CARD_TOOLS, DISPATCH_CHANNEL, STATUS_TOOLS } from '../shared/contracts.js'
import type { RpcEndpoints, RpcResult } from '../shared/contracts.js'
import { ProposalCard, ProposalView, validStatus } from './card.js'
import type { Request } from './card.js'
import { WorkersCard, WorkersView } from './workers.js'
import { ProposalTrace, ProposalTurnTail } from './turn-tail.js'
import type { TraceProps, TurnTailProps } from './turn-tail.js'

interface ClientContext {
  get?(name: string): unknown
  slots: {
    inject(name: string, callback: () => unknown): unknown
    register<P>(
      seat:
        | { name: 'tool.call.toolview'; key: string }
        | { name: 'conversation.chat.turnTail'; id: string },
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
    const request = createRequest(ctx)
    // Native Session navigation when the workspace UI is mounted; otherwise no control.
    const workspace = () =>
      ctx.get?.('uiWorkspace') as { openSession(sessionId: string): void } | undefined
    const openSession = (sessionId: string) => workspace()?.openSession(sessionId)
    const navigation = () => (workspace() ? openSession : undefined)
    // A native footer exists only after turn/end. Keep the trace card usable
    // until then; once the footer exists, it owns the only approval controls.
    function Card(props: Omit<TraceProps, 'request' | 'openSession'>) {
      return React.createElement(ProposalTrace, { ...props, request, openSession: navigation() })
    }
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
    for (const key of CARD_TOOLS)
      ctx.slots.inject('tool.call.toolview', () =>
        ctx.slots.register<Omit<TraceProps, 'request' | 'openSession'>>(
          { name: 'tool.call.toolview', key },
          Card,
        ),
      )
    for (const key of STATUS_TOOLS)
      ctx.slots.inject('tool.call.toolview', () =>
        ctx.slots.register<{ sessionId: string }>({ name: 'tool.call.toolview', key }, Workers),
      )
  },
}
