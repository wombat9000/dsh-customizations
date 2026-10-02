import { GoogleAuthSettingsSection } from './settings.js'
import { api, authorizationUrl } from './transport.js'
import type { ComponentType } from 'react'
import type { SettingsProps } from './settings.js'
// Consumed plugins.row.config contract, unchanged from the RC2 registration.
interface ClientContext {
  on?(name: 'connection/reset', listener: () => void): () => void
  slots: {
    inject(name: 'plugins.row.config', callback: () => unknown): unknown
    register(
      options: {
        name: 'plugins.row.config'
        key: string
        order: number
        inject: () => Omit<SettingsProps, 'view'>
      },
      component: ComponentType<SettingsProps>,
    ): unknown
  }
}
function apply(ctx: ClientContext) {
  const subscribe = (listener: () => void) =>
    typeof ctx.on === 'function' ? ctx.on('connection/reset', listener) : () => {}
  ctx.slots.inject('plugins.row.config', () =>
    ctx.slots.register(
      {
        name: 'plugins.row.config',
        key: '@local/dsh-google-auth#local-google-auth',
        order: 25,
        inject: () => ({ api, subscribe }),
      },
      GoogleAuthSettingsSection,
    ),
  )
}
export default { apply, inject: ['slots'], GoogleAuthSettingsSection, authorizationUrl }
