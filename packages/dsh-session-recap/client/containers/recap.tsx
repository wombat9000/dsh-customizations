import React from 'react'
import { useRecapStyles } from '../styles.ts'
import { RecapActionButton } from '../components/RecapActionButton.tsx'
import { RecapPanel } from '../components/RecapPanel.tsx'
import type { ChatSnapshot, AssistantActionOwnerProps, TurnTailChatData } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { Controller } from '../controller-types.ts'

// RC2's published composed props reference ui-slots, absent from the pinned graph.
// Keep only the consumed standard hook surface here, using published snapshots
// where their declarations are self-contained; no Context or hook-wide cast.
export type SelectorHook<S> = <T>(selector: (snapshot: S) => T) => T
export interface SessionLifecycle { blank: boolean; openState: string; running: boolean }
export interface RecapSessionProps {
  sessionId: string
  useSession: SelectorHook<SessionLifecycle>
  useChat: SelectorHook<ChatSnapshot>
  controller: Controller
}
export interface RecapActionProps extends RecapSessionProps, Pick<AssistantActionOwnerProps, 'messageId'> {}
export interface RecapCardProps extends RecapSessionProps {
  useConversation: SelectorHook<ConversationSnapshot>
}

function useRecapState(controller: Controller, sessionId: string) {
  return React.useSyncExternalStore(
    React.useCallback((listener) => controller.subscribe(sessionId, listener), [controller, sessionId]),
    React.useCallback(() => controller.getSnapshot(sessionId), [controller, sessionId]),
  )
}

// RC2 assistant-actions is a session-scoped list, not a selector chain.
// Returning null removes only our entry; native actions remain. Read live nodes
// inside the selector: nodes/locations are stable readers. The latest closed
// timeline Turn's turn-tail owns the canonical closing assistant.
export function latestClosingMessage(chat: ChatSnapshot) {
  const turn = chat.timeline.turnOrder.at(-1)
  if (turn === undefined || chat.timeline.turns.get(turn)?.status !== 'closed') return undefined
  for (const key of chat.locations.getTurn(turn)) {
    const node = chat.nodes.get(key)
    if (node?.kind === 'turn-tail') {
      // ChatNodeStore.get exposes data as unknown, not a discriminated ChatNode.
      // This renderer kind owns the published TurnTailChatData payload in RC2.
      const data = node.data as TurnTailChatData
      if (data.closing?.status === 'settled') return data.closing.finalNode.messageId
    }
  }
  return undefined
}

export function RecapAction({ sessionId, messageId, useSession, useChat, controller }: RecapActionProps) {
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

export function RecapCard({ sessionId, useSession, useConversation, useChat, controller }: RecapCardProps) {
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
