import React, { useSyncExternalStore } from 'react'
import { parseReplies, TOOL } from '../shared/replies.ts'

type Selector<S> = <T>(selector: (snapshot: S) => T) => T
interface Source<T> {
  subscribe(listener: () => void): () => void
  getSnapshot(): T
}
interface ToolBlock {
  kind?: string
  name: string
  seq?: number
  callId: string
  isError?: boolean
  content?: readonly { type: string; text?: string }[]
  subCalls: readonly ToolBlock[]
}
interface Chat {
  timeline: {
    turnOrder: readonly number[]
    turns: ReadonlyMap<
      number,
      {
        status: string
        end?: { data: { reason: { kind: string } } }
      }
    >
  }
  nodes: { turnDataSource(turn: number, kind: 'tool-call'): Source<readonly { root: ToolBlock }[]> }
}
// Consumed subsets of the published 0.2.1-rc.3 session standard props. The
// integration journey verifies the real slot, tool projection, and input actions.
export interface ReplyProps {
  useSession: Selector<{ blank: boolean; openState: string; running: boolean }>
  useChat: Selector<Chat>
  useInput: Selector<{ draft: string; phase: string; attachmentIds: readonly unknown[] }>
  inputActions: {
    captureInsertion(): unknown
    insertText(text: string, span: unknown): boolean
    persistDraft(): void
  }
}

function latestSuggestions(rows: readonly { root: ToolBlock }[]) {
  let latest: ToolBlock | undefined
  function visit(block: ToolBlock) {
    if (
      block.name === TOOL &&
      block.kind === 'tool-result' &&
      !block.isError &&
      (latest === undefined || (block.seq ?? -1) > (latest.seq ?? -1))
    )
      latest = block
    for (const child of block.subCalls) visit(child)
  }
  for (const row of rows) visit(row.root)
  if (!latest) return []
  try {
    const content = latest.content
    const text = content?.length === 1 && content[0]?.type === 'text' ? content[0].text : undefined
    return typeof text === 'string' && text.length <= 2000 ? parseReplies(JSON.parse(text)) : []
  } catch {
    return []
  }
}

const css = `
.dsh-suggest-replies{box-sizing:border-box;width:calc(100% - 32px);max-width:var(--dsh-chat-content-width,680px);margin:0 auto 8px;display:flex;flex-wrap:wrap;gap:6px}
.dsh-suggest-replies button{max-width:100%;border:1px solid var(--dsw-alias-border-l2,#8885);border-radius:12px;background:var(--dsw-alias-bg-layer-2,transparent);color:var(--dsw-alias-label-secondary,inherit);padding:7px 12px;font:inherit;font-size:13px;line-height:1.4;text-align:left;overflow-wrap:anywhere;cursor:pointer}
.dsh-suggest-replies button:hover{background:var(--dsw-alias-interactive-bg-hover,#8882);color:var(--dsw-alias-label-primary,inherit)}
.dsh-suggest-replies button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,currentColor);outline-offset:2px}
`

export function Replies({ useSession, useChat, useInput, inputActions }: ReplyProps) {
  const ready = useSession(
    (session) => !session.blank && session.openState === 'open' && !session.running,
  )
  const empty = useInput(
    (input) => input.phase === 'plain' && input.draft === '' && input.attachmentIds.length === 0,
  )
  const turn = useChat((chat) => {
    const id = chat.timeline.turnOrder.at(-1)
    const current = id === undefined ? undefined : chat.timeline.turns.get(id)
    return current?.status === 'closed' && current.end?.data.reason.kind === 'completed'
      ? id
      : undefined
  })
  const source = useChat((chat) => chat.nodes.turnDataSource(turn ?? -1, 'tool-call'))
  const rows = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot)
  const replies = latestSuggestions(rows)
  if (!ready || !empty || turn === undefined || !replies.length) return null
  return (
    <div className="dsh-suggest-replies" role="group" aria-label="Suggested replies">
      <style>{css}</style>
      {replies.map((reply) => (
        <button
          key={reply}
          type="button"
          onClick={() => {
            // CAS guards edits/submission made after the selection was captured.
            const span = inputActions.captureInsertion()
            if (inputActions.insertText(reply, span)) inputActions.persistDraft()
          }}
        >
          {reply}
        </button>
      ))}
    </div>
  )
}
