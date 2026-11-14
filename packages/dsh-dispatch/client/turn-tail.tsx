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
    values(): readonly {
      readonly kind: string
      readonly data: unknown
      readonly location: unknown
    }[]
  }
}
type UseChat = <T>(selector: (snapshot: ChatSnapshot) => T) => T
export interface TurnTailProps {
  sessionId: string
  turn: { readonly turn: number }
  useChat: UseChat
}
export interface TraceProps extends CardProps {
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

/** A trace keeps the original card until its actual native footer is present. */
export function ProposalTrace(props: TraceProps) {
  const surface = props.useChat((snapshot) => {
    const nodes = snapshot.nodes.values()
    const owner = nodes.find(
      (node) =>
        node.kind === 'tool-call' &&
        object(node.data) &&
        proposalCalls([{ root: node.data.root }]).includes(props.callId),
    )
    // Tool views survive preparing -> start -> result under the same identity.
    // Do not read status before preparation finishes: a not-found response is
    // terminal for the card and would otherwise hide the later ready proposal.
    if (!owner) return 'none'
    const location = owner.location
    if (!object(location) || !object(location.turn)) return 'trace'
    const turn = location.turn.turn
    return nodes.some(
      (node) => node.kind === 'turn-tail' && object(node.data) && node.data.turn === turn,
    )
      ? 'tail'
      : 'trace'
  })
  if (surface === 'none') return null
  return surface === 'tail' ? (
    <p className="dsp-muted">Review the Dispatch proposal below this conversation turn.</p>
  ) : (
    <ProposalCard {...props} />
  )
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
