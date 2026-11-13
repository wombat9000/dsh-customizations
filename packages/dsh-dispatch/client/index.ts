import type { ComponentType } from 'react'
import React from 'react'
import { CARD_TOOLS, DISPATCH_CHANNEL, STATUS_TOOLS } from '../shared/contracts.js'
import type { RpcEndpoints, RpcResult } from '../shared/contracts.js'
import { ProposalCard, ProposalView, validStatus } from './card.js'
import type { Request } from './card.js'
import { WorkersCard, WorkersView } from './workers.js'

interface ClientContext {
  get?(name: string): unknown
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
    // Keyed by the actual Dispatch tool names; other tool cards and the shared
    // approval-detail slot are untouched.
    function Card(props: { sessionId: string; callId: string }) {
      return React.createElement(ProposalCard, { ...props, request, openSession: navigation() })
    }
    function Workers(props: { sessionId: string }) {
      return React.createElement(WorkersCard, {
        sessionId: props.sessionId,
        request,
        openSession: navigation(),
      })
    }
    for (const key of CARD_TOOLS)
      ctx.slots.inject('tool.call.toolview', () =>
        ctx.slots.register<{ sessionId: string; callId: string }>(
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
