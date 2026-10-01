import * as React from 'react'
import type { CardProps, PendingInteraction } from '../shared/contracts.ts'
import { api } from './transport.ts'
import { FIELD_TOOL, validFieldStatus, type FieldStatus } from './field-model.ts'
import { TOOL, validStatus, type GrantStatus } from './grant-model.ts'
import { object } from './validation.ts'

type Domain = 'field' | 'grant'
type Status = FieldStatus | GrantStatus
interface Observation<S> {
  status: S | null
  pending: PendingInteraction | undefined
  error: string
}
interface GrantObservation extends Observation<GrantStatus> {
  busy: boolean
  refresh: () => void
  revoke: (grantId: string) => Promise<void>
}
interface Loaded {
  sessionId: string
  callId: string
  domain: Domain
  status: Status | null
  error: string
  busy: boolean
}

// The two domains share observation mechanics, not a caller-configured polling policy.
export function useGitHubCallPresentation(
  domain: 'field',
  props: CardProps,
): Observation<FieldStatus>
export function useGitHubCallPresentation(domain: 'grant', props: CardProps): GrantObservation
export function useGitHubCallPresentation(
  domain: Domain,
  { sessionId, callId, block, useSessionStatus, request = api }: CardProps,
): Observation<Status> & {
  busy: boolean
  refresh: () => void
  revoke: (grantId: string) => Promise<void>
} {
  const toolName = domain === 'field' ? FIELD_TOOL : TOOL
  const pending =
    typeof useSessionStatus === 'function'
      ? useSessionStatus((map) => {
          const value = map.get(sessionId)?.pendingInteraction
          return value?.kind === 'approval' &&
            value.callId === callId &&
            value.toolName === toolName
            ? value
            : undefined
        })
      : undefined
  const [loaded, setLoaded] = React.useState<Loaded | null>(null)
  const [revision, refresh] = React.useReducer((n: number) => n + 1, 0)
  const generation = React.useRef(0)
  const action = React.useRef<AbortController | null>(null)
  const polling = React.useRef<{
    controller: AbortController
    timer?: ReturnType<typeof setTimeout>
  } | null>(null)
  const current =
    loaded?.sessionId === sessionId && loaded.callId === callId && loaded.domain === domain
      ? loaded
      : null
  const status = current?.status ?? null
  React.useEffect(() => {
    const token = ++generation.current
    const observation: NonNullable<typeof polling.current> = { controller: new AbortController() }
    polling.current = observation
    let failures = 0
    const update = (status: Status | null, error = '') =>
      setLoaded({ sessionId, callId, domain, status, error, busy: false })
    update(null)
    async function load() {
      if (generation.current !== token) return
      try {
        const value = await request('status', { sessionId, callId }, observation.controller.signal)
        if (generation.current !== token) return
        let validated: Status
        let continueObserving: boolean
        if (domain === 'field') {
          if (!validFieldStatus(value, callId)) throw new Error('Invalid prepared change')
          validated = value
          continueObserving = [
            'preparing',
            'prepared',
            'approved',
            'authorized-by-grant',
            'running',
            'awaiting-approval',
          ].includes(value.phase)
        } else {
          if (!validStatus(value, callId))
            throw new Error('Invalid GitHub grant status. Access is not confirmed.')
          validated = value
          // A completed request can still hold live authority. Observe revocation and account changes.
          continueObserving =
            [
              'preparing',
              'prepared',
              'approved',
              'pending',
              'awaiting-approval',
              'running',
            ].includes(value.phase) || value.grants.some((grant) => grant.state === 'active')
        }
        update(validated)
        failures = 0
        if (continueObserving) observation.timer = setTimeout(load, 1500)
      } catch (failure) {
        if (generation.current !== token || observation.controller.signal.aborted) return
        update(
          null,
          domain === 'field'
            ? 'Prepared change details are unavailable. See the native approval preview and raw tool details; no previous value or outcome is inferred.'
            : object(failure) && typeof failure.message === 'string' && failure.message
              ? failure.message
              : 'GitHub status is unavailable. Access is not confirmed.',
        )
        if (++failures <= 3) observation.timer = setTimeout(load, 1500)
      }
    }
    void load()
    return () => {
      generation.current++
      observation.controller.abort()
      clearTimeout(observation.timer)
      action.current?.abort()
      action.current = null
      if (polling.current === observation) polling.current = null
    }
  }, [domain, sessionId, callId, request, revision, pending?.key, block?.kind])

  async function revoke(grantId: string) {
    if (
      domain !== 'grant' ||
      action.current ||
      !status ||
      !('grants' in status) ||
      !status.grants.some((grant) => grant.id === grantId && grant.state === 'active')
    )
      return
    // Fence and abort all older polls before the action. Its response cannot establish authority.
    const token = ++generation.current,
      controller = new AbortController()
    polling.current?.controller.abort()
    clearTimeout(polling.current?.timer)
    action.current = controller
    setLoaded({ sessionId, callId, domain, status, error: '', busy: true })
    try {
      await request('revoke', { sessionId, callId, grantId }, controller.signal)
      if (generation.current !== token) return
      refresh()
    } catch {
      if (generation.current !== token || controller.signal.aborted) return
      setLoaded({
        sessionId,
        callId,
        domain,
        status: null,
        busy: false,
        error:
          'Revocation could not be confirmed. Refresh status before relying on it. This action did not request a GitHub write.',
      })
    } finally {
      if (generation.current === token) {
        action.current = null
        setLoaded((value) => (value ? { ...value, busy: false } : value))
      }
    }
  }
  return {
    status,
    pending,
    error: current?.error ?? '',
    busy: current?.busy ?? false,
    refresh,
    revoke,
  }
}
