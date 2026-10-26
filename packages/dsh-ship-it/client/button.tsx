import React from 'react'
import type { PropsRuntime, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { ComposerBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

export type ShipItProps = Pick<
  PropsRuntime<'conversation.session.header.utilities'>,
  'sessionId' | 'useSession' | 'useAccess' | 'useInput'
> & {
  send: () => Promise<void>
  useBlock: SnapshotSelectorHook<ComposerBlock | undefined>
}

export function ShipItButton({ useSession, useAccess, useInput, useBlock, send }: ShipItProps) {
  const session = useSession((value) => value)
  const allowed = useAccess('session/prompt')
  const phase = useInput((value) => value.phase)
  const block = useBlock((value) => value)
  const [sending, setSending] = React.useState(false)
  const [error, setError] = React.useState(false)
  const inFlight = React.useRef(false)
  const errorId = React.useId()
  const reason =
    session.openState !== 'open' || session.removed
      ? 'Wait for this session to open.'
      : !allowed
        ? 'You do not have permission to send messages to this session.'
        : (block?.reason ??
          (session.running || session.pendingSubmissions.length > 0
            ? 'Wait for the agent to finish before shipping.'
            : phase === 'adjudicating' || phase === 'submitting'
              ? 'Wait for the current message to finish sending.'
              : null))
  const disabled = sending || reason !== null

  // A header contribution is bound to one Session. The registration keys this
  // component by identity, so a late rejection cannot appear in another Session.
  if (session.blank || session.subagent !== null) return null

  async function submit() {
    if (disabled || inFlight.current) return
    inFlight.current = true // Covers repeated clicks before React rerenders.
    setSending(true)
    setError(false)
    try {
      await send()
    } catch {
      // Transport failure may happen after Host admission. Never retry a push
      // instruction automatically or claim the shipping operation itself failed.
      setError(true)
    } finally {
      inFlight.current = false
      setSending(false)
    }
  }

  return (
    <span style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
      <button
        type="button"
        aria-label="Ship it"
        aria-busy={sending}
        aria-describedby={error ? errorId : undefined}
        disabled={disabled}
        title={
          reason ?? 'Send the shipping instructions to this session. Your draft stays unchanged.'
        }
        onClick={() => void submit()}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          minHeight: 30,
          padding: '4px 10px',
          border: '1px solid var(--dsw-alias-border-l1)',
          borderRadius: 8,
          background: 'var(--dsw-alias-bg-layer-1)',
          color: disabled ? 'var(--dsw-alias-label-tertiary)' : 'var(--dsw-alias-label-primary)',
          font: 'inherit',
          fontSize: 12,
          whiteSpace: 'nowrap',
          cursor: disabled ? 'default' : 'pointer',
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m3 9 14-6-6 14-2-6-6-2Zm6 2 4-4" />
        </svg>
        {sending ? 'Sending…' : 'Ship it'}
      </button>
      {error && (
        <span
          id={errorId}
          role="alert"
          style={{
            position: 'absolute',
            // Leave room for DSH's native prompt-error toast at the top.
            top: 'calc(100% + 56px)',
            right: 0,
            zIndex: 50,
            width: 'min(300px, calc(100vw - 32px))',
            padding: 12,
            boxSizing: 'border-box',
            border: '1px solid var(--dsw-alias-border-l1)',
            borderRadius: 8,
            background: 'var(--dsw-alias-bg-layer-1)',
            color: 'var(--dsw-alias-label-primary)',
            fontSize: 12,
            lineHeight: 1.5,
            whiteSpace: 'normal',
          }}
        >
          Could not confirm the shipping request. Check the conversation before trying again.
        </span>
      )}
    </span>
  )
}
