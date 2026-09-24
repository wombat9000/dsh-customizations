import { CHANNEL, createSettingsReader, errorMessage, unwrap } from './rpc.ts'
import { createActivityStore, createReturnTracker } from './return-tracker.ts'
import type { RecapResult } from '../shared/contracts.ts'
import type { Controller, ControllerOptions, ControllerSnapshot, MountEnvironment, SessionObservation, SessionState, SnapshotListener } from './controller-types.ts'

// Session state and recap request transitions are independent of React mounts.
export function createController({ rpc, storage, now = Date.now }: ControllerOptions): Controller {
  const states = new Map<string, SessionState>()
  const settingsReader = createSettingsReader(rpc)
  const { settings } = settingsReader
  const activityStore = createActivityStore({ storage, now })

  function state(sessionId: string): SessionState {
    let session = states.get(sessionId)
    if (!session) {
      session = { value: {}, listeners: new Set(), pending: null, generation: 0 }
      states.set(sessionId, session)
    }
    return session
  }

  function publish(session: SessionState, value: ControllerSnapshot) {
    session.value = value
    for (const listener of session.listeners) listener(value)
  }

  function requestOpening(session: SessionState) {
    publish(session, { ...session.value, openOnReady: true })
  }

  function beginRecap(session: SessionState, automatic: boolean) {
    publish(session, {
      ...session.value,
      busy: true,
      error: undefined,
      unread: false,
      open: false,
      openOnReady: !automatic,
    })
  }

  function completeRecap(session: SessionState, result: RecapResult) {
    const open = session.value.openOnReady === true
    publish(session, {
      busy: false,
      recap: result.recap,
      selection: result.selection,
      open,
      unread: !open,
      openOnReady: false,
    })
  }

  function failRecap(session: SessionState, error: unknown) {
    publish(session, {
      ...session.value,
      busy: false,
      open: session.value.openOnReady === true,
      openOnReady: false,
      error: errorMessage(error),
    })
  }

  async function recap(sessionId: string, automatic = false): Promise<void> {
    const session = state(sessionId)
    if (session.pending) {
      if (!automatic) requestOpening(session)
      return session.pending
    }
    const generation = session.generation
    beginRecap(session, automatic)
    const pending = Promise.resolve()
      .then(() => rpc.call(CHANNEL, 'recap', { sessionId, automatic }))
      .then(unwrap)
      .then((result) => {
        if (generation !== session.generation) return
        if (result.sessionId !== sessionId) {
          throw new Error('Session recap returned a different session.')
        }
        completeRecap(session, result)
      })
      .catch((error: unknown) => {
        if (generation === session.generation) failRecap(session, error)
      })
      .finally(() => {
        if (session.pending === pending) session.pending = null
      })
    session.pending = pending
    return pending
  }

  function mount(sessionId: string, { document, window }: MountEnvironment, listener: SnapshotListener) {
    const session = state(sessionId)
    session.listeners.add(listener)
    listener(session.value)
    const tracker = createReturnTracker({
      sessionId, document, window, rpc, settings, activityStore, now,
      state: session, publish, recap,
    })
    return () => {
      tracker.leave()
      tracker.deactivate()
      session.listeners.delete(listener)
      tracker.removeHandlers()
    }
  }

  function discard(sessionId: string) {
    const session = states.get(sessionId)
    if (!session) return
    session.generation++
    session.pending = null
    publish(session, {})
  }

  function click(sessionId: string) {
    const session = state(sessionId)
    if (session.value.busy) {
      requestOpening(session)
      return session.pending
    }
    if (session.value.recap && !session.value.error) {
      publish(session, { ...session.value, open: !session.value.open, unread: false })
      return
    }
    return recap(sessionId)
  }

  function observeSession(sessionId: string, observation: SessionObservation) {
    const session = state(sessionId)
    const previous = session.observation
    // Keep the last loaded baseline through dock remounts/history reloads.
    if (!observation.ready) return
    if (previous && (
      (!previous.running && observation.running) ||
      (observation.latestTurn !== undefined && (previous.latestTurn === undefined || observation.latestTurn > previous.latestTurn))
    )) {
      discard(sessionId)
    }
    session.observation = observation
  }

  function humanMessageSent(sessionId: string) {
    discard(sessionId)
    // A successful send counts as activity even without a mounted dock.
    void settings().then((config) => {
      activityStore.touch(activityStore.key(config, sessionId))
    }, () => {})
  }

  return {
    mount,
    recap,
    click,
    turnStarted: discard,
    observeSession,
    getSnapshot(sessionId) { return state(sessionId).value },
    subscribe(sessionId, listener) {
      const session = state(sessionId)
      session.listeners.add(listener)
      return () => session.listeners.delete(listener)
    },
    invalidateSettings: settingsReader.invalidate,
    humanMessageSent,
  }
}
