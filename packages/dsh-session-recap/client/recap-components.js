// React views use controller snapshots; styles, card vocabulary and diagnostics
// are sibling fragments in the same factory, never additional runtime modules.
function useRecapState(controller, sessionId) {
  return React.useSyncExternalStore(
    React.useCallback((listener) => controller.subscribe(sessionId, listener), [controller, sessionId]),
    React.useCallback(() => controller.getSnapshot(sessionId), [controller, sessionId]),
  )
}

function recapIcon(className) {
  const h = React.createElement
  return h('svg', { className, 'aria-hidden': true, focusable: 'false', width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' },
    h('rect', { x: 5, y: 3, width: 14, height: 18, rx: 3 }),
    h('path', { d: 'M9 8h6M9 12h6M9 16h3' }))
}

// RC2 chat/contract/{slots,snapshot,chat-nodes}.d.ts: assistant-actions is a
// session-scoped list (owner: messageId), not a selector chain. Returning null
// removes only our entry; native actions remain. Session standard props inject
// useChat/useSession/useConversation. Read live nodes INSIDE the selector:
// nodes/locations are stable readers, not immutable React dependencies. The
// latest timeline Turn must be closed; its turn-tail owns the canonical closing
// assistant, unlike the last rendered row (pagination/folds/hidden tool steps).
function latestClosingMessage(chat) {
  const turn = chat.timeline.turnOrder.at(-1)
  if (turn === undefined || chat.timeline.turns.get(turn)?.status !== 'closed') return undefined
  for (const key of chat.locations.getTurn(turn)) {
    const node = chat.nodes.get(key)
    if (node?.kind === 'turn-tail' && node.data.closing?.status === 'settled') {
      return node.data.closing.finalNode.messageId
    }
  }
  return undefined
}

function recapActionLabel(state) {
  if (state.busy) return 'Open recap when ready'
  if (state.error) return 'Retry recap'
  if (state.recap) return state.open ? 'Hide recap' : 'Show recap'
  return 'Generate recap'
}

function RecapAction({ sessionId, messageId, useSession, useChat, controller }) {
  const blank = useSession((session) => session.blank) !== false
  const closingMessageId = useChat(latestClosingMessage)
  const state = useRecapState(controller, sessionId)
  const visible = !blank && !!messageId && messageId === closingMessageId
  // Historical action seats must not each install a duplicate stylesheet.
  useRecapStyles(visible)
  if (!visible) return null
  const label = recapActionLabel(state)
  return React.createElement('button', {
    type: 'button', className: 'dsh-session-recap-action',
    'data-busy': !!state.busy, 'data-unread': !!state.unread, 'data-open': !!state.open,
    title: state.busy ? 'Generating recap…' : state.error ? `Retry recap: ${state.error}` : label,
    'aria-label': label, 'aria-expanded': !!state.open,
    onClick: () => { void controller.click(sessionId) },
  }, recapIcon('dsh-session-recap-action__icon'),
  state.error ? React.createElement('span', { className: 'dsh-session-recap-action__warning', 'aria-hidden': true }, '!') : null)
}

function renderVisualCard(card) {
  const h = React.createElement
  const label = CARD_LABELS[card.label]
  return h('li', { key: card.label, 'data-recap-card': card.label, className: 'dsh-session-recap-card__tile' },
    h('h3', { className: 'dsh-session-recap-card__title' },
      h('svg', { className: 'dsh-session-recap-card__icon', style: { '--recap-accent': label.accent }, 'aria-hidden': true, focusable: 'false', width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' },
        h('path', { d: label.path })), label.title),
    h('p', { className: 'dsh-session-recap-card__text' }, card.text.slice(0, 180)))
}

function renderRecapList(recap, cards) {
  const h = React.createElement
  if (cards.length) {
    return h('ul', { role: 'list', 'aria-label': 'Recap cards', className: 'dsh-session-recap-card__grid' }, ...cards.map(renderVisualCard))
  }
  const bullets = (Array.isArray(recap.bullets) ? recap.bullets : [])
    .filter(bullet => typeof bullet === 'string')
  return h('ul', { className: 'dsh-session-recap-card__list' },
    ...bullets.map((bullet, index) => h('li', { key: index, className: 'dsh-session-recap-card__row' }, bullet)))
}

function selectionCaption(selection) {
  if (selection?.mode !== 'standard') return null
  if (selection.reason === 'unavailable') return 'Jev unavailable'
  if (selection.reason === 'no-labels') return 'No suitable categories'
  return null
}

function RecapCard({ sessionId, useSession, useConversation, useChat, controller }) {
  const state = useRecapState(controller, sessionId)
  const blank = useSession((session) => session.blank) !== false
  const ready = useSession((session) => session.openState === 'open')
  const running = useSession((session) => session.running)
  const hasChat = useConversation((conversation) => conversation.activeTargets.has('chat'))
  const latestTurn = useChat((chat) => chat.timeline.turnOrder.at(-1))
  useRecapStyles()
  // The always-mounted dock observes delegated/resumed turns too. RC2
  // Session.running covers early starts; Chat timeline catches complete turns
  // between renders/remounts. Conversation.activeTargets means visible CONTENT
  // (chat isActive tests non-command nodes), NOT busy. Together with openState
  // it gates the initial loaded baseline. Pagination only adds older turns.
  React.useEffect(() => {
    controller.observeSession(sessionId, { ready: ready && (hasChat || blank), running, latestTurn })
  }, [controller, sessionId, ready, hasChat, blank, running, latestTurn])
  // Card visibility never controls this subscription or idle-return tracking.
  React.useEffect(() => {
    if (!blank) return controller.mount(sessionId, { document, window }, () => {})
  }, [controller, sessionId, blank])
  if (blank || running || !state.open || !(state.error || state.recap)) return null
  const h = React.createElement
  const cards = visualCards(state.recap)
  const caption = selectionCaption(state.selection)
  return h('aside', { 'aria-label': 'Session recap', className: 'dsh-session-recap-card' },
    state.busy ? h('p', { role: 'status', className: 'dsh-session-recap-card__loading' }, 'Generating recap…') : null,
    state.error ? h('p', { role: 'alert', className: 'dsh-session-recap-card__error' }, state.error) : null,
    state.recap ? h('div', { tabIndex: 0, 'aria-label': 'Recap content', className: `dsh-session-recap-card__body${cards.length ? ' dsh-session-recap-card__body--cards' : ''}` },
      h('div', { role: state.busy ? undefined : 'status' },
        typeof state.recap.headline === 'string' && state.recap.headline.trim()
          ? h('h2', { className: 'dsh-session-recap-card__headline', title: state.recap.headline }, state.recap.headline)
          : null,
        renderRecapList(state.recap, cards),
        caption ? h('p', { className: 'dsh-session-recap-card__caption' }, caption) : null),
      state.selection?.diagnostics ? h(SelectionDetails, { key: sessionId, diagnostics: state.selection.diagnostics }) : null) : null)
}
