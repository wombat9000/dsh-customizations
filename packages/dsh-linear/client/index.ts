import { CREDENTIAL_REF, SETTINGS_NAMESPACE } from '../shared/rpc.js'
import { LinearConfigPage, type SettingsProps } from './settings.js'
import type { ComponentType } from 'react'
import type { SettingsRpc } from '../shared/rpc.js'
export { CREDENTIAL_REF, SETTINGS_NAMESPACE, CHANNEL } from '../shared/rpc.js'
export { apiKeyFailure } from '../shared/api-key.js'
export { LinearSettingsSection } from './settings.js'
export const inject = ['slots', 'connection', 'remote']
interface ClientContext {
  get(name: 'connection'): { rpc: SettingsRpc }
  remote: {
    $on(
      event: 'credentials/reference-updated' | 'settings/document-updated',
      listener: (value: string) => void,
    ): () => void
  }
  on(event: 'connection/reset', listener: () => void): () => void
  slots: {
    inject(name: 'plugins.row.config', callback: () => unknown): unknown
    register(
      options: {
        name: 'plugins.row.config'
        key: string
        order: number
        inject(): Pick<SettingsProps, 'rpc' | 'subscribe'>
      },
      component: ComponentType<SettingsProps>,
    ): () => void
  }
}
export function apply(ctx: ClientContext) {
  const connection = ctx.get('connection')
  const subscribe = (listener: () => void) => {
    const disposers = [
      ctx.remote.$on('credentials/reference-updated', (ref) => {
        if (ref === CREDENTIAL_REF) listener()
      }),
      ctx.remote.$on('settings/document-updated', (ns) => {
        if (ns === SETTINGS_NAMESPACE) listener()
      }),
      ctx.on('connection/reset', listener),
    ]
    return () => {
      for (const dispose of disposers) dispose()
    }
  }
  ctx.slots.inject('plugins.row.config', () =>
    ctx.slots.register(
      {
        name: 'plugins.row.config',
        key: '@local/dsh-linear#local-linear',
        order: 35,
        inject: () => ({ rpc: connection.rpc, subscribe }),
      },
      LinearConfigPage,
    ),
  )
}
