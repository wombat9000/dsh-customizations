import type { ComponentType } from 'react'
import { SettingsCard, type SettingsProps } from './settings.tsx'
import type { Rpc } from './rpc.ts'

// RC2 plugin-manager owns this keyed settings seat. The injected Connection
// transport is the native object, not a per-render adapter.
interface Context {
  get(name: 'connection'): { rpc: Rpc }
  slots: {
    inject(name: 'plugins.row.config', callback: () => unknown): unknown
    register(
      options: {
        name: 'plugins.row.config'
        key: string
        inject(): { rpc: Rpc }
      },
      component: ComponentType<SettingsProps>,
    ): () => void
  }
}
export function apply(ctx: Context) {
  ctx.slots.inject('plugins.row.config', () =>
    ctx.slots.register(
      {
        name: 'plugins.row.config',
        key: '@local/dsh-jev#local-jev',
        inject: () => ({ rpc: ctx.get('connection').rpc }),
      },
      SettingsCard,
    ),
  )
}
export { SettingsCard }
export default { inject: ['slots', 'connection'], apply, SettingsCard }
