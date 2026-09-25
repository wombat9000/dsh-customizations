import React from 'react'
import type { CardProps } from '../shared/contracts.ts'
import { api } from './transport.ts'
import { TOOL, validStatus } from './grant-model.ts'
import type { GrantStatus } from './grant-model.ts'
import { GrantPresentation } from './grant-components.tsx'
import { object } from './validation.ts'
export function GrantCard({
  sessionId,
  callId,
  block,
  inspect,
  useSessionPendingInteraction,
  request = api,
}: CardProps) {
  const pending =
    typeof useSessionPendingInteraction === 'function'
      ? useSessionPendingInteraction((map) => {
          const value = map.get(sessionId)
          return value?.kind === 'approval' && value.callId === callId && value.toolName === TOOL
            ? value
            : undefined
        })
      : undefined
  const [loaded, setLoaded] = React.useState<{
    sessionId: string
    callId: string
    value: GrantStatus
  } | null>(null)
  const [error, setError] = React.useState(''),
    [busy, setBusy] = React.useState(false)
  const [revision, refresh] = React.useReducer((n: number) => n + 1, 0)
  const generation = React.useRef(0),
    action = React.useRef<AbortController | null>(null)
  const status = loaded?.sessionId === sessionId && loaded?.callId === callId ? loaded.value : null
  React.useEffect(() => {
    const token = ++generation.current,
      controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined,
      failures = 0
    setLoaded(null)
    setError('')
    setBusy(false)
    async function load() {
      if (generation.current !== token) return
      try {
        const value = await request('status', { sessionId, callId }, controller.signal)
        if (generation.current !== token) return
        if (!validStatus(value, callId))
          throw new Error('Invalid GitHub grant status. Access is not confirmed.')
        setLoaded({ sessionId, callId, value })
        setError('')
        failures = 0
        // Keep observing active authority for revocation/account changes elsewhere.
        if (
          ['preparing', 'prepared', 'approved', 'pending', 'awaiting-approval', 'running'].includes(
            value.phase,
          ) ||
          value.grants.some((grant) => grant.state === 'active')
        )
          timer = setTimeout(load, 1500)
      } catch (failure) {
        if (generation.current !== token || controller.signal.aborted) return
        setLoaded(null)
        setError(
          object(failure) && typeof failure.message === 'string' && failure.message
            ? failure.message
            : 'GitHub status is unavailable. Access is not confirmed.',
        )
        if (++failures <= 3) timer = setTimeout(load, 1500)
      }
    }
    void load()
    return () => {
      generation.current++
      controller.abort()
      action.current?.abort()
      action.current = null
      clearTimeout(timer)
    }
  }, [sessionId, callId, request, revision, pending?.key, block?.kind])
  async function revoke(grantId: string) {
    if (
      action.current ||
      !status?.grants.some((grant) => grant.id === grantId && grant.state === 'active')
    )
      return
    // Fence previous status requests before revocation; status alone confirms authority.
    const controller = new AbortController(),
      token = ++generation.current
    action.current = controller
    setBusy(true)
    setError('')
    try {
      await request('revoke', { sessionId, callId, grantId }, controller.signal)
      if (generation.current !== token) return
      refresh()
    } catch {
      if (generation.current !== token) return
      setLoaded(null)
      setError(
        'Revocation could not be confirmed. Refresh status before relying on it. This action did not request a GitHub write.',
      )
    } finally {
      if (generation.current === token) {
        action.current = null
        setBusy(false)
      }
    }
  }
  let phase = pending ? 'awaiting-approval' : status?.phase
  if (
    !pending &&
    phase !== undefined &&
    ['active', 'granted', 'confirmed'].includes(phase) &&
    !status?.grants.some((grant) => grant.state === 'active')
  ) {
    const states = new Set(status?.grants.map((grant) => grant.state))
    phase = states.size === 1 ? [...states][0] : undefined
  }
  return (
    <GrantPresentation
      status={status}
      pending={pending}
      phase={phase}
      error={error}
      busy={busy}
      block={block}
      inspect={inspect}
      refresh={refresh}
      revoke={revoke}
    />
  )
}
