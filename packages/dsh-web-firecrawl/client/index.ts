import React from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ComponentType } from 'react'
import type { CredentialAPI, Subscribe } from '../shared/contracts.js'

// RC2 plugin row configuration is a keyed slot. The declared peer does not
// expose the slots service type; describe only this consumed seat.
interface Context extends Pick<ClientContext, 'remote' | 'on'> {
  slots: {
    inject(name: 'plugins.row.config', callback: () => unknown): unknown
    register(
      options: {
        name: 'plugins.row.config'
        key: string
        order: number
        inject: () => { api: CredentialAPI; subscribe: Subscribe }
      },
      component: ComponentType<FirecrawlSettingsProps>,
    ): () => void
  }
}
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { CREDENTIAL_REF } from '../shared/contracts.js'
import { FirecrawlSettingsSection } from './FirecrawlSettingsSection.js'
import type { FirecrawlSettingsProps } from './FirecrawlSettingsSection.js'

export { FirecrawlSettingsSection } from './FirecrawlSettingsSection.js'
export { apiKeyFailure } from './validation.js'

// RC2 row summaries never mount the credential form or start status requests.
function FirecrawlConfigPage(props: FirecrawlSettingsProps) {
  return props.view === 'summary'
    ? 'Configure Firecrawl access for web search and fetch.'
    : React.createElement(FirecrawlSettingsSection, props)
}

export const inject = ['slots', 'remote', 'remote.credentials']

export function apply(ctx: Context) {
  const subscribe = (listener: () => void) => {
    const disposers = [
      ctx.remote.$on('credentials/reference-updated', (ref) => {
        if (ref === CREDENTIAL_REF) listener()
      }),
      ctx.on('connection/reset', listener),
    ]
    return () => {
      for (const dispose of disposers) dispose()
    }
  }
  const injected = () => ({ api: ctx.remote, subscribe })
  ctx.slots.inject('plugins.row.config', () =>
    ctx.slots.register(
      {
        name: 'plugins.row.config',
        key: '@local/dsh-web-firecrawl#local-web-firecrawl',
        order: 20,
        inject: injected,
      },
      FirecrawlConfigPage,
    ),
  )
}
