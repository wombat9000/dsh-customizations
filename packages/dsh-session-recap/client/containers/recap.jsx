import React from 'react'
import { useRecapStyles } from '../styles.js'
import { RecapActionButton } from '../components/RecapActionButton.jsx'
import { RecapPanel } from '../components/RecapPanel.jsx'

function useRecapState(controller, sessionId) {
  return React.useSyncExternalStore(
    React.useCallback((listener) => controller.subscribe(sessionId, listener), [controller, sessionId]),
    React.useCallback(() => controller.getSnapshot(sessionId), [controller, sessionId]),
  )
}

// RC2 assistant-actions is a session-scoped list, not a selector chain.
// Returning null removes only our entry; native actions remain. Read live nodes
// inside the selector: nodes/locations are stable readers. The latest closed
// timeline Turn's turn-tail owns the canonical closing assistant.
export function latestClosingMessage(chat) {
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

export function RecapAction({ sessionId, messageId, useSession, useChat, controller }) {
  const blank = useSession((session) => session.blank) !== false
  const closingMessageId = useChat(latestClosingMessage)
  const state = useRecapState(controller, sessionId)
  const visible = !blank && !!messageId && messageId === closingMessageId
  // Historical action seats must not each install a duplicate stylesheet.
  useRecapStyles(visible)
  if (!visible) return null
  return <RecapActionButton
    busy={state.busy}
    error={state.error}
    recap={state.recap}
    open={state.open}
    unread={state.unread}
    onClick={() => { void controller.click(sessionId) }}
  />
}

export function RecapCard({ sessionId, useSession, useConversation, useChat, controller }) {
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
  return <RecapPanel
    busy={state.busy}
    error={state.error}
    recap={state.recap}
    selection={state.selection}
    diagnosticsKey={sessionId}
  />
}
