import type { ComponentType } from 'react'
import type { RpcTransport } from '../shared/contracts.js'
import { FastToggle, IntegrationSettings } from './controls.js'
import type { FastToggleProps, IntegrationProps } from './controls.js'
interface Context {
  get(name: 'connection'): { rpc: RpcTransport }
  slots: {
    inject(name: string, callback: () => unknown): unknown
    register<P>(
      options: { name: string; id?: string; key?: string; order?: number; inject(): Partial<P> },
      component: ComponentType<P>,
    ): unknown
  }
}
export function apply(ctx: Context) {
  ctx.slots.inject('conversation.input.left', () =>
    ctx.slots.register<FastToggleProps>(
      {
        name: 'conversation.input.left',
        id: 'local-codex-fast',
        order: 10,
        inject: () => ({ rpc: ctx.get('connection').rpc }),
      },
      FastToggle,
    ),
  )
  ctx.slots.inject('plugins.row.config', () =>
    ctx.slots.register<IntegrationProps>(
      {
        name: 'plugins.row.config',
        key: '@local/dsh-codex-fast#local-codex-fast',
        inject: () => ({ rpc: ctx.get('connection').rpc }),
      },
      IntegrationSettings,
    ),
  )
}
export default { inject: ['slots', 'connection'], apply }
