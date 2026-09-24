import { ID } from './rpc.js'
import { createController } from './controller.js'
import { RecapAction, RecapCard } from './containers/recap.jsx'
import { SettingsCard } from './containers/SettingsCard.jsx'

export function apply(ctx) {
  let storage
  try {
    storage = window.localStorage
  } catch {}
  const controller = createController({ rpc: ctx.get('connection').rpc, storage })
  // DSH emits this only after a durable human-authored user/message.
  ctx.get('remote').$on('api-session/activity', (sessionId) => controller.humanMessageSent(sessionId))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock', id: ID, order: 10,
    inject: (sessionId) => ({ sessionId, controller }),
  }, RecapCard))
  ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
    name: 'conversation.chat.assistant-actions', id: `${ID}-action`, order: 10,
    inject: (sessionId) => ({ sessionId, controller }),
  }, RecapAction))
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item', key: ID, inject: () => ({ rpc: ctx.get('connection').rpc, controller }),
  }, SettingsCard))
}
