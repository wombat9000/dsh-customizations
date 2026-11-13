import type { ComponentType } from 'react'
import React from 'react'
import { CARD_TOOLS, DISPATCH_CHANNEL } from '../shared/contracts.js'
import type { RpcEndpoints, RpcResult } from '../shared/contracts.js'
import { ProposalCard, ProposalView, validStatus } from './card.js'
import type { Request } from './card.js'

interface ClientContext {
  slots: {
    inject(name: string, callback: () => unknown): unknown
    register<P>(
      seat: { name: string; key: string; inject?: (...args: string[]) => Partial<P> },
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
  validStatus,
  apply(ctx: ClientContext) {
    const request = createRequest(ctx)
    // Keyed by the actual Dispatch tool names; other tool cards and the shared
    // approval-detail slot are untouched.
    function Card(props: { sessionId: string; callId: string }) {
      return React.createElement(ProposalCard, { ...props, request })
    }
    for (const key of CARD_TOOLS)
      ctx.slots.inject('tool.call.toolview', () =>
        ctx.slots.register<{ sessionId: string; callId: string }>(
          { name: 'tool.call.toolview', key },
          Card,
        ),
      )
  },
}
