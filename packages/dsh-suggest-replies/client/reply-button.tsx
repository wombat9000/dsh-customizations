import React, { useEffect, useRef, useState } from 'react'

interface ReplyButtonProps {
  reply: string
  selected: boolean
  disabled: boolean
  onToggle(): void
  onSend(): void
}

// Pointer holds are deliberate sends. A short click remains an editable toggle.
export function ReplyButton({ reply, selected, disabled, onToggle, onSend }: ReplyButtonProps) {
  const [holding, setHolding] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const suppressClick = useRef(false)
  const origin = useRef<{ x: number; y: number } | undefined>(undefined)
  const send = useRef(onSend)
  send.current = onSend

  function cancel(suppress = true) {
    if (timer.current !== undefined) clearTimeout(timer.current)
    timer.current = undefined
    origin.current = undefined
    if (suppress) suppressClick.current = true
    setHolding(false)
  }

  useEffect(() => {
    if (disabled) cancel()
  }, [disabled])
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel()
    }
    const blur = () => cancel()
    const visibility = () => {
      if (document.hidden) cancel()
    }
    window.addEventListener('keydown', escape)
    window.addEventListener('blur', blur)
    window.addEventListener('scroll', blur, true)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      if (timer.current !== undefined) clearTimeout(timer.current)
      window.removeEventListener('keydown', escape)
      window.removeEventListener('blur', blur)
      window.removeEventListener('scroll', blur, true)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [])

  return (
    <span className="dsh-reply-choice">
      <button
        type="button"
        className="dsh-reply-toggle"
        aria-pressed={selected}
        disabled={disabled}
        data-holding={holding || undefined}
        title="Click to toggle in your draft. Hold to send only this reply; release early to cancel sending."
        onPointerDown={(event) => {
          if (disabled || event.button !== 0 || !event.isPrimary) return
          cancel(false)
          suppressClick.current = false
          origin.current = { x: event.clientX, y: event.clientY }
          event.currentTarget.setPointerCapture(event.pointerId)
          setHolding(true)
          timer.current = setTimeout(() => {
            timer.current = undefined
            origin.current = undefined
            suppressClick.current = true
            setHolding(false)
            send.current()
          }, 700)
        }}
        onPointerMove={(event) => {
          const start = origin.current
          const box = event.currentTarget.getBoundingClientRect()
          if (
            start &&
            (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10 ||
              event.clientX < box.left ||
              event.clientX > box.right ||
              event.clientY < box.top ||
              event.clientY > box.bottom)
          )
            cancel()
        }}
        onPointerUp={() => cancel(false)}
        onPointerLeave={() => cancel()}
        onPointerCancel={() => cancel()}
        onBlur={() => cancel()}
        onLostPointerCapture={() => {
          if (origin.current) cancel()
        }}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') suppressClick.current = false
        }}
        onClick={() => {
          if (suppressClick.current) {
            suppressClick.current = false
            return
          }
          onToggle()
        }}
      >
        <span>{reply}</span>
      </button>
      <button
        type="button"
        className="dsh-reply-send"
        aria-label={`Send now: ${reply}`}
        title="Send only this reply now. Your draft stays unchanged."
        disabled={disabled}
        onClick={onSend}
      >
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="m3 9 14-6-6 14-2-6-6-2Zm6 2 4-4" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
    </span>
  )
}
