import { ReconnectCodex } from './oauth/reconnect.js'
import type { ReconnectCodexProps } from './oauth/reconnect.js'
import type { ComponentType } from 'react'
import type { RpcTransport } from '../shared/contracts.js'
import { FastToggle, IntegrationSettings } from './fast/controls.js'
import type { FastToggleProps, IntegrationProps } from './fast/controls.js'
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
  // RC2: this session-scoped list renders immediately before the native model picker.
  // It supplies the same session/projection props as input.left and replaces no native control.
  ctx.slots.inject('conversation.input.right', () =>
    ctx.slots.register<FastToggleProps>(
      {
        name: 'conversation.input.right',
        id: 'local-codex-fast',
        order: 10,
        inject: () => ({ rpc: ctx.get('connection').rpc }),
      },
      FastToggle,
    ),
  )
  // RC3 keys this slot by settings namespace. The control filters by provider ID.
  ctx.slots.inject('settings.models.provider-card', () =>
    ctx.slots.register<ReconnectCodexProps>(
      {
        name: 'settings.models.provider-card',
        key: 'llm-pi-ai',
        inject: () => ({ rpc: ctx.get('connection').rpc }),
      },
      ReconnectCodex,
    ),
  )
  ctx.slots.inject('plugins.row.config', () =>
    ctx.slots.register<IntegrationProps>(
      {
        name: 'plugins.row.config',
        key: '@local/dsh-codex-compat#local-codex-fast',
        inject: () => ({ rpc: ctx.get('connection').rpc }),
      },
      IntegrationSettings,
    ),
  )
}
export default { inject: ['slots', 'connection'], apply }
