import type { ComponentType } from 'react'
import type { StatusRpc } from '../shared/contracts.js'
import { TrivySettingsSection, type SettingsProps } from './settings.js'

// RC2 settings.section uses injected component props and registration-scoped disposal.
// This private status channel consumes the host's normalized, path-free response.
export interface ClientContext {
  get(name: 'connection'): { rpc: StatusRpc }
  on(name: 'connection/reset', listener: () => void): () => void
  slots: {
    inject(name: 'settings.section', setup: () => () => void): unknown
    register(
      options: {
        name: 'settings.section'
        id: 'trivy'
        order: number
        label: string
        inject(): SettingsProps
      },
      component: ComponentType<SettingsProps>,
    ): () => void
  }
}
export const inject = ['slots', 'connection']
export function apply(ctx: ClientContext) {
  const connection = ctx.get('connection')
  const subscribe = (listener: () => void) => ctx.on('connection/reset', listener)
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'trivy',
        order: 40,
        label: 'Trivy',
        inject: () => ({ rpc: connection.rpc, subscribe }),
      },
      TrivySettingsSection,
    ),
  )
}
