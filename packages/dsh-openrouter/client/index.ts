import type { ComponentType } from 'react'
import type { RpcTransport } from '../shared/contracts.js'
import { SettingsCard } from './settings.js'
import type { SettingsProps } from './settings.js'

// The pinned RC2 row slot injects the transport and owns view selection.
interface Context {
  get(name: 'connection'): { rpc: RpcTransport }
  slots: {
    inject(name: 'plugins.row.config', callback: () => unknown): unknown
    register(
      options: {
        name: 'plugins.row.config'
        key: string
        inject(): { rpc: RpcTransport }
      },
      component: ComponentType<SettingsProps>,
    ): () => void
  }
}

export function apply(ctx: Context) {
  // DSH 0.1.7 row pages are keyed by bundle package and patch row id.
  ctx.slots.inject('plugins.row.config', () =>
    ctx.slots.register(
      {
        name: 'plugins.row.config',
        key: '@local/dsh-openrouter#local-openrouter',
        inject: () => ({ rpc: ctx.get('connection').rpc }),
      },
      SettingsCard,
    ),
  )
}

export { SettingsCard }
export default { inject: ['slots', 'connection'], apply, SettingsCard }
