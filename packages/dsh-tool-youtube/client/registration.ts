import type { RegistrationContext } from './contracts.ts'
import { CREDENTIAL_REF, YOUTUBE_TOOLS } from './constants.ts'
import { YoutubeConfigPage } from './settings.tsx'
import { YoutubeToolCard } from './tool-card.tsx'
export const inject = ['slots', 'connection', 'remote', 'remote.credentials']

export function apply(ctx: RegistrationContext) {
  const connection = ctx.get('connection')
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
        key: '@local/dsh-tool-youtube#local-tool-youtube',
        order: 30,
        inject: injected,
      },
      YoutubeConfigPage,
    ),
  )
  ctx.slots.inject('tool.call.toolview', () => {
    const disposers = YOUTUBE_TOOLS.map((key) =>
      ctx.slots.register(
        {
          name: 'tool.call.toolview',
          key,
          locale: 'conversation',
          inject: () => ({ rpc: connection.rpc }),
        },
        YoutubeToolCard,
      ),
    )
    return () => {
      for (const dispose of [...disposers].reverse()) dispose()
    }
  })
}
