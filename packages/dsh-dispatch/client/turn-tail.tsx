import React from 'react'
import { CARD_TOOLS } from '../shared/contracts.js'
import { ProposalCard } from './card.js'
import type { CardProps } from './card.js'

// Narrow consumed rc.3 contracts: ui-chat contract/{snapshot,chat-nodes,slots}.ts
// and ui-conversation contract/records.ts. The per-turn source includes hidden
// tool nodes. A fresh list id adds content without replacing native Chat nodes.
interface ToolData {
  readonly root: unknown
}
interface ToolSource {
  getSnapshot(): readonly ToolData[]
  subscribe(listener: () => void): () => void
}
interface ChatSnapshot {
  readonly nodes: {
    turnDataSource(turn: number, kind: 'tool-call'): ToolSource
  }
}
type UseChat = <T>(selector: (snapshot: ChatSnapshot) => T) => T
export interface TurnTailProps {
  sessionId: string
  turn: { readonly turn: number }
  useChat: UseChat
}
const tools = new Set<string>(CARD_TOOLS)
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object'

/** Only settled, successful proposal tools can have prepared an approval. */
function proposalCalls(data: readonly ToolData[]): string[] {
  const calls = new Set<string>()
  const seen = new Set<unknown>()
  const pending = data.map(({ root }) => root).toReversed()
  while (pending.length) {
    const block = pending.pop()
    if (!object(block) || seen.has(block)) continue
    seen.add(block)
    if (Array.isArray(block.subCalls)) pending.push(...block.subCalls.toReversed())
    if (
      block.kind === 'tool-result' &&
      block.isError !== true &&
      typeof block.name === 'string' &&
      tools.has(block.name) &&
      typeof block.callId === 'string' &&
      block.callId
    )
      calls.add(block.callId)
  }
  return [...calls]
}

export function ProposalTurnTail({
  sessionId,
  turn,
  useChat,
  request,
  openSession,
}: TurnTailProps & Pick<CardProps, 'request' | 'openSession'>) {
  const source = useChat((snapshot) => snapshot.nodes.turnDataSource(turn.turn, 'tool-call'))
  const data = React.useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot)
  return (
    <>
      {proposalCalls(data).map((callId) => (
        <ProposalCard
          key={`${sessionId}:${callId}`}
          sessionId={sessionId}
          callId={callId}
          request={request}
          openSession={openSession}
        />
      ))}
    </>
  )
}
