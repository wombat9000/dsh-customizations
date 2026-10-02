import * as React from 'react'
import type { Api, SessionStatus } from './contracts.js'
import { api, validSessionStatus } from './rpc.js'
export interface SessionToggleProps {
  sessionId: string
  useSession?: (
    selector: (session: { blank?: boolean }) => boolean | undefined,
  ) => boolean | undefined
  api?: Api
}
interface ToggleView {
  status: SessionStatus | null
  busy: boolean
  error: string
}
interface ToggleMachine {
  live: boolean
  busy: boolean
  status: SessionStatus | null
  controller: AbortController | null
  timer: ReturnType<typeof setTimeout> | undefined
  blocked?: boolean
  load: (notice?: string, background?: boolean) => Promise<void>
  toggle: () => Promise<void>
}
export function SessionToggle({ sessionId, useSession, api: request = api }: SessionToggleProps) {
  const blank = useSession ? useSession((session) => session.blank) : false
  return (
    <SessionToggleState
      key={`${sessionId}:${blank === true}`}
      sessionId={sessionId}
      request={request}
    />
  )
}

export function SessionToggleState({ sessionId, request }: { sessionId: string; request: Api }) {
  const [view, setView] = React.useState<ToggleView>({ status: null, busy: true, error: '' })
  const machine = React.useRef<ToggleMachine | null>(null)
  React.useEffect(() => {
    const state: ToggleMachine = {
      live: true,
      busy: false,
      status: null,
      controller: null,
      timer: undefined,
      load: async () => {},
      toggle: async () => {},
    }
    machine.current = state
    const publish = (error: string) => {
      if (state.live) setView({ status: state.status, busy: state.busy, error })
    }
    const accept = (value: unknown) => {
      if (!validSessionStatus(value))
        throw new Error('Invalid session status. Refresh status before changing Google Drive.')
      if (
        value.available &&
        state.status?.available &&
        value.ownerId === state.status.ownerId &&
        (value.revision < state.status.revision ||
          (value.revision === state.status.revision && value.enabled !== state.status.enabled))
      )
        throw new Error('Session status is stale. Refresh status.')
      state.status = value
    }
    state.load = async (notice = '', background = false) => {
      if (!state.live || state.busy) return
      clearTimeout(state.timer)
      state.controller?.abort()
      const controller = new AbortController()
      state.controller = controller
      const current = () => state.live && state.controller === controller
      state.busy = !background
      if (!background) publish(notice)
      try {
        const value = sessionId
          ? await request('session-status', { sessionId }, controller.signal)
          : { available: false, enabled: false }
        if (!current()) return
        accept(value)
        state.blocked = false
        publish(notice)
      } catch (error) {
        if (!current()) return
        state.blocked = true
        publish('Cannot confirm Google Drive session status. Retry status check.')
      } finally {
        if (current()) {
          state.busy = false
          setView((previous) => ({ ...previous, status: state.status, busy: false }))
          state.timer = setTimeout(() => state.load('', true), 3000)
        }
      }
    }
    state.toggle = async () => {
      if (!state.live || state.busy || state.blocked || !state.status?.available) return
      clearTimeout(state.timer)
      const previous = state.status
      // A user action supersedes an in-flight background read. Its late
      // response must not replace the mutation's authoritative status.
      state.controller?.abort()
      state.busy = true
      publish('')
      state.controller = new AbortController()
      try {
        const value = await request(
          'session-set',
          {
            sessionId,
            ownerId: previous.ownerId,
            revision: previous.revision,
            enabled: !previous.enabled,
          },
          state.controller.signal,
        )
        if (!state.live) return
        if (
          !validSessionStatus(value) ||
          (value.available &&
            (value.ownerId !== previous.ownerId ||
              value.revision <= previous.revision ||
              value.enabled !== !previous.enabled))
        )
          throw new Error('Unconfirmed mutation')
        accept(value)
        state.busy = false
        publish('')
        state.timer = setTimeout(() => state.load('', true), 3000)
      } catch {
        if (!state.live) return
        state.blocked = true
        state.busy = false
        await state.load(
          'Change could not be confirmed. Checking authoritative status; no change is retried.',
        )
      }
    }
    void state.load()
    return () => {
      state.live = false
      state.controller?.abort()
      clearTimeout(state.timer)
    }
  }, [sessionId, request])
  const disabled = view.busy || !view.status?.available || machine.current?.blocked
  return (
    <div className={'gd-session-toggle'}>
      {
        <style>{`
        .gd-session-toggle { position:relative; display:inline-flex; flex-wrap:wrap; max-width:100%; align-items:center; gap:6px; font:12px/1.4 var(--dsw-font-family,system-ui); color:var(--dsw-alias-label-secondary); }
        .gd-session-toggle button { font:inherit; color:inherit; cursor:pointer; border:1px solid var(--dsw-alias-border-l2); background:transparent; border-radius:7px; padding:5px 8px; }
        .gd-session-toggle button:disabled { cursor:default; opacity:.55; }
        .gd-session-toggle button:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:2px; }
        .gd-session-toggle [role=switch] { display:inline-flex; align-items:center; gap:7px; white-space:nowrap; }
        .gd-session-toggle [aria-checked=true] { color:var(--dsw-alias-brand-primary); }
        .gd-toggle-track { width:24px; height:14px; border-radius:9px; background:var(--dsw-alias-border-l2); padding:2px; }
        .gd-toggle-track::after { content:''; display:block; width:10px; height:10px; border-radius:50%; background:var(--dsw-alias-label-secondary); }
        [aria-checked=true] .gd-toggle-track { background:var(--dsw-alias-brand-primary); }
        [aria-checked=true] .gd-toggle-track::after { transform:translateX(10px); background:var(--dsw-alias-bg-layer-1); }
        .gd-toggle-message { width:min(280px,80vw); padding:10px; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; background:var(--dsw-alias-bg-layer-1); }
      `}</style>
      }
      {
        <button
          type={'button'}
          role={'switch'}
          aria-label={'Google Drive'}
          aria-checked={view.status?.enabled === true}
          disabled={disabled}
          title={
            view.status?.available === false
              ? 'Start or resume this session to enable Google Drive'
              : 'Enable Drive and Sheets tools for this session'
          }
          onClick={() => machine.current?.toggle()}
        >
          {<span className={'gd-toggle-track'} aria-hidden={true} />}
          {'Google Drive'}
        </button>
      }
      {
        <span role={'status'} style={{ fontSize: 11 }}>
          {view.busy ? 'Checking…' : !view.status?.available ? 'Unavailable' : ''}
        </span>
      }
      {
        <span
          title={
            'Enabling grants no file access. Turning OFF revokes session grants, cancels requests and previews, and removes tools. It cannot undo dispatched writes.'
          }
          aria-label={
            'Enabling grants no file access. Turning OFF revokes session grants, cancels requests and previews, and removes tools. It cannot undo dispatched writes.'
          }
          tabIndex={0}
        >
          {'ⓘ'}
        </span>
      }
      {view.error && (
        <div className={'gd-toggle-message'} role={'alert'}>
          {view.error}{' '}
          {
            <button type={'button'} disabled={view.busy} onClick={() => machine.current?.load()}>
              {'Retry status check'}
            </button>
          }
        </div>
      )}
    </div>
  )
}
