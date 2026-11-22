import type { Context } from '../../client/context.js'
import { ReconnectCodex } from '../../client/oauth/reconnect.js'
import type { ReconnectCodexProps } from '../../client/oauth/reconnect.js'

export function apply(ctx: Context) {
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
}
export default { inject: ['slots', 'connection'], apply }
