import React, { useSyncExternalStore } from 'react'
import { Translation, type Translate } from './locale.ts'
import { messages } from './messages.ts'
import type { ComponentType } from 'react'
import { Projects } from './projects.tsx'
import type { Request, RpcResult, RpcEndpoints } from '../shared/contracts.ts'

// RC2: sidebar owns the button; main is a root-scoped keyed seat, not a session seat.
interface Context {
  effect(callback: () => () => void): unknown
  locale: {
    register(namespace: string, locale: string, dictionary: Record<string, string>): () => void
    bind(namespace: string): Translate
    getSnapshot(): unknown
    subscribe(listener: () => void): () => void
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
  slots: {
    inject(name: string, callback: () => unknown): unknown
    register(
      options: {
        name: 'sidebar.panellist'
        id: string
        order: number
        label: string | (() => string)
      },
      component: ComponentType<{ size: number; active: boolean }>,
    ): () => void
    register(options: { name: 'main'; key: string }, component: ComponentType): () => void
  }
}
export function Icon({ size, active }: { size: number; active: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 2 : 1.5}
      aria-hidden="true"
    >
      <path d="M3 7h7l2-3h9v16H3z" />
    </svg>
  )
}
export function apply(ctx: Context) {
  ctx.effect(() => ctx.locale.register('local-projects', 'en', messages))
  const translate = ctx.locale.bind('local-projects')
  const subscribe = (listener: () => void) => ctx.locale.subscribe(listener)
  const snapshot = () => ctx.locale.getSnapshot()
  function Panel() {
    const locale = useSyncExternalStore(subscribe, snapshot)
    // Renew context identity on locale changes; keep the transport stable.
    const t = React.useCallback((key: string) => translate(key), [locale])
    return (
      <Translation.Provider value={t}>
        <Projects request={request} />
      </Translation.Provider>
    )
  }
  const request: Request = async <E extends keyof RpcEndpoints>(
    endpoint: E,
    input: RpcEndpoints[E]['input'],
    signal?: AbortSignal,
  ) => {
    const result = await ctx.connection.rpc.call('/projects', endpoint, input, signal)
    if (!result.ok) throw new Error(result.error.message)
    // Host validates configuration and projects normalized projections on this private channel.
    return result.value as RpcEndpoints[E]['result']
  }
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      {
        name: 'sidebar.panellist',
        id: 'local-projects',
        label: () => translate('Projects'),
        order: 10,
      },
      Icon,
    ),
  )
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'local-projects' }, Panel))
}
export default { inject: ['slots', 'connection', 'locale'], apply }
