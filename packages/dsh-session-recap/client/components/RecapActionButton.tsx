import React from 'react'
import type { ControllerSnapshot } from '../controller-types.ts'

export type RecapActionLabelProps = Pick<ControllerSnapshot, 'busy' | 'error' | 'recap' | 'open'>
export interface RecapActionButtonProps extends RecapActionLabelProps {
  unread?: boolean | undefined
  onClick: React.MouseEventHandler<HTMLButtonElement>
}

export function recapActionLabel({ busy, error, recap, open }: RecapActionLabelProps) {
  if (busy) return 'Open recap when ready'
  if (error) return 'Retry recap'
  if (recap) return open ? 'Hide recap' : 'Show recap'
  return 'Generate recap'
}

export function RecapActionButton({
  busy,
  error,
  recap,
  open,
  unread,
  onClick,
}: RecapActionButtonProps) {
  const label = recapActionLabel({ busy, error, recap, open })
  return (
    <button
      type="button"
      className="dsh-session-recap-action"
      data-busy={!!busy}
      data-unread={!!unread}
      data-open={!!open}
      title={busy ? 'Generating recap…' : error ? `Retry recap: ${error}` : label}
      aria-label={label}
      aria-expanded={!!open}
      onClick={onClick}
    >
      <svg
        className="dsh-session-recap-action__icon"
        aria-hidden={true}
        focusable="false"
        width={16}
        height={16}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x={5} y={3} width={14} height={18} rx={3} />
        <path d="M9 8h6M9 12h6M9 16h3" />
      </svg>
      {error ? (
        <span className="dsh-session-recap-action__warning" aria-hidden={true}>
          !
        </span>
      ) : null}
    </button>
  )
}
