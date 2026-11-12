import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { parseReplies, TOOL } from '../shared/replies.ts'
import { ReplyButton } from './reply-button.tsx'
import type { DeliveryState } from './delivery.ts'
import { reconcileSelection, toggleSelection, type SelectionState } from './selection.ts'

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
// Consumed subsets of the published 0.2.2-rc.2 session standard props. The
// integration journey verifies the real slot, tool projection, and input actions.
export interface ReplyProps {
  useSession: Selector<{
    blank: boolean
    removed: boolean
    openState: string
    running: boolean
    pendingSubmissions: readonly unknown[]
  }>
  useChat: Selector<Chat>
  useAccess(capability: 'session/prompt'): boolean
  useBlock: Selector<{ reason: string } | undefined>
  useDelivery: Selector<DeliveryState | undefined>
  useInput: Selector<{
    draft: string
    draftRev: number
    phase: string
    claim?: unknown
    occurrences: readonly unknown[]
    attachmentIds: readonly unknown[]
  }>
  inputActions: {
    insertText(text: string, span: { start: number; end: number; draftRev: number }): boolean
    persistDraft(): void
  }
  send(reply: string, turn: number): Promise<void>
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
.dsh-reply-choice{display:inline-flex;max-width:100%;border:1px solid var(--dsw-alias-border-l2,#8885);border-radius:12px;background:var(--dsw-alias-bg-layer-2,transparent)}
.dsh-suggest-replies button{position:relative;min-width:0;border:0;border-radius:11px;background:transparent;color:var(--dsw-alias-label-secondary,inherit);padding:7px 12px;font:inherit;font-size:13px;line-height:1.4;text-align:left;overflow-wrap:anywhere;cursor:pointer;touch-action:pan-y}
.dsh-suggest-replies button:hover{background:var(--dsw-alias-interactive-bg-hover,#8882);color:var(--dsw-alias-label-primary,inherit)}
.dsh-suggest-replies button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,currentColor);outline-offset:2px;z-index:1}
.dsh-suggest-replies button:disabled{opacity:.5;cursor:default}
.dsh-suggest-replies .dsh-reply-toggle{overflow:hidden;border-radius:11px 0 0 11px}
.dsh-reply-toggle[aria-pressed=true]{background:var(--dsw-alias-interactive-bg-hover,#8882);color:var(--dsw-alias-label-primary,inherit);box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary,currentColor)}
.dsh-reply-toggle::before{content:'';position:absolute;inset:0;background:var(--dsw-alias-brand-primary,currentColor);opacity:.25;transform:scaleX(0);transform-origin:left;pointer-events:none}
.dsh-reply-toggle[data-holding]::before{animation:dsh-reply-hold .7s linear forwards}
.dsh-reply-toggle>span{position:relative}
.dsh-suggest-replies .dsh-reply-send{display:flex;align-items:center;flex-shrink:0;padding:7px 9px;border-left:1px solid var(--dsw-alias-border-l2,#8885);border-radius:0 11px 11px 0}
.dsh-reply-notice{width:100%;font-size:12px;color:var(--dsw-alias-label-secondary,inherit)}
@keyframes dsh-reply-hold{to{transform:scaleX(1)}}
`

export function Replies({
  useSession,
  useChat,
  useInput,
  useAccess,
  useBlock,
  useDelivery,
  inputActions,
  send,
}: ReplyProps) {
  const ready = useSession(
    (session) =>
      !session.blank &&
      !session.removed &&
      session.openState === 'open' &&
      !session.running &&
      session.pendingSubmissions.length === 0,
  )
  const allowed = useAccess('session/prompt')
  const block = useBlock((value) => value)
  const input = useInput((value) => value)
  // Plain-text offsets differ from chip offsets; never replace structured drafts.
  const editable = input.phase === 'plain' && !input.claim && input.occurrences.length === 0
  const delivery = useDelivery((value) => value)
  const sending = delivery?.phase === 'pending'
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
  const scope = JSON.stringify([turn, replies])
  const [selection, setSelection] = useState<SelectionState & { scope: string }>({
    scope,
    draft: input.draft,
    selections: [],
  })
  const current = useMemo(
    () =>
      reconcileSelection(
        selection.scope === scope ? selection : { draft: input.draft, selections: [] },
        input.draft,
      ),
    [selection, scope, input.draft],
  )
  useEffect(() => {
    if (current !== selection) setSelection({ ...current, scope })
  }, [current, selection, scope])
  const visible = ready && allowed && editable && !block && turn !== undefined && replies.length > 0
  const sent = delivery !== undefined && delivery.turn === turn && delivery.phase === 'sent'
  const error = delivery !== undefined && delivery.turn === turn && delivery.phase === 'error'
  const disabled = sending || sent

  async function submit(reply: string) {
    if (!visible || disabled || turn === undefined) return
    try {
      // The session-owned delivery latch survives view remounts and retains a
      // successful admission until the turn advances. It owns duplicate guards.
      await send(reply, turn)
    } catch {
      // Delivery publishes uncertainty to the view; never retry automatically.
    }
  }

  if (!visible) return null
  return (
    <div
      className="dsh-suggest-replies"
      role="group"
      aria-label="Suggested replies"
      aria-busy={sending}
    >
      <style>{css}</style>
      {replies.map((reply) => (
        <ReplyButton
          key={`${scope}:${reply}`}
          reply={reply}
          selected={current.selections.some((selection) => selection.reply === reply)}
          disabled={disabled}
          onToggle={() => {
            if (disabled) return
            const next = toggleSelection(current, reply)
            // Text and revision come from one snapshot. A stale render cannot
            // replace later edits. The native action also preserves undo.
            if (
              inputActions.insertText(next.draft, {
                start: 0,
                end: input.draft.length,
                draftRev: input.draftRev,
              })
            ) {
              setSelection({ ...next, scope })
              inputActions.persistDraft()
            }
          }}
          onSend={() => void submit(reply)}
        />
      ))}
      {sent && (
        <span className="dsh-reply-notice" role="status">
          Reply sent. Waiting for the conversation to update.
        </span>
      )}
      {error && (
        <span className="dsh-reply-notice" role="alert">
          Could not confirm this reply was sent. Check the conversation before trying again.
        </span>
      )}
    </div>
  )
}
