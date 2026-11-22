import type { ComponentType } from 'react'
import type { RpcTransport } from '../shared/contracts.js'

export interface Context {
  get(name: 'connection'): { rpc: RpcTransport }
  slots: {
    inject(name: string, callback: () => unknown): unknown
    register<P>(
      options: { name: string; id?: string; key?: string; order?: number; inject(): Partial<P> },
      component: ComponentType<P>,
    ): unknown
  }
}
