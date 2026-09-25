import { ID, CHANNEL, errorMessage, unwrap } from './rpc.ts'
import type { ScopedSettings } from '../shared/contracts.ts'
import type {
  ActivityStorage,
  ActivityStore,
  EventSource,
  ReturnTrackerOptions,
} from './controller-types.ts'

// Only timestamps enter browser storage. Recap text stays in memory.
export function createActivityStore({
  storage,
  now,
}: {
  storage?: ActivityStorage | undefined
  now: () => number
}): ActivityStore {
  const memory = new Map<string, string>()

  function key(config: ScopedSettings, sessionId: string) {
    return typeof config.storageScope === 'string' && config.storageScope
      ? `${ID}:activity:${JSON.stringify([config.storageScope, sessionId])}`
      : undefined
  }

  function read(key: string | undefined) {
    if (!key) return undefined
    let raw = memory.get(key)
    try {
      raw = storage?.getItem(key) ?? raw
    } catch {}
    const value = Number(raw)
    return raw != null && Number.isFinite(value) && value >= 0 && value <= now() ? value : undefined
  }

  function touch(key: string | undefined) {
    if (!key) return
    const value = String(now())
    memory.set(key, value)
    try {
      storage?.setItem(key, value)
    } catch {}
  }

  return { key, read, touch }
}

// Each dock mount owns its focus/visibility lifetime and its retry timer.
// Controller generations independently invalidate in-flight session work.
export function createReturnTracker({
  sessionId,
  document,
  window,
  rpc,
  settings,
  activityStore,
  now,
  state,
  publish,
  recap,
}: ReturnTrackerOptions) {
  const { key, read, touch } = activityStore
  let alive = true
  let active = false
  let activityKey: string | undefined
  let currentConfig: ScopedSettings | undefined
  let checking = false
  let retry: ReturnType<typeof setTimeout> | undefined
  let generation = 0

  function visible() {
    return (
      document.visibilityState !== 'hidden' &&
      (typeof document.hasFocus !== 'function' || document.hasFocus())
    )
  }

  async function checkReturn(config: ScopedSettings) {
    if (checking) return
    if (!config.autoRecap || !config.provider || !config.model) {
      touch(activityKey)
      return
    }
    checking = true
    const token = generation
    const recapGeneration = state.generation
    try {
      const activity = unwrap(await rpc.call(CHANNEL, 'activity', { sessionId }))
      if (
        !alive ||
        !active ||
        token !== generation ||
        recapGeneration !== state.generation ||
        !visible()
      )
        return
      // A live session appears only after persisted history has loaded.
      // Do not claim the visit until loading and the active turn finish.
      if (!activity.ready || activity.running) {
        clearTimeout(retry)
        retry = setTimeout(() => {
          if (alive && active && currentConfig) void checkReturn(currentConfig)
        }, 1000)
        return
      }
      clearTimeout(retry)
      const stored = read(activityKey)
      const fallback = activity.latestActivity
      const previous =
        stored ??
        (typeof fallback === 'number' &&
        Number.isFinite(fallback) &&
        fallback >= 0 &&
        fallback <= now()
          ? fallback
          : undefined)
      // Claim this return before any billable call, including errors.
      touch(activityKey)
      const minutes =
        Number.isFinite(config.inactivityMinutes) && config.inactivityMinutes > 0
          ? config.inactivityMinutes
          : 30
      if (previous !== undefined && now() - previous >= minutes * 60000) {
        void recap(sessionId, true)
      }
    } catch (error) {
      if (alive && active && token === generation && recapGeneration === state.generation) {
        publish(state, { ...state.value, error: errorMessage(error) })
      }
    } finally {
      checking = false
    }
  }

  async function enter() {
    if (!alive || active || !visible()) return
    active = true
    const token = ++generation
    const recapGeneration = state.generation
    try {
      const config = await settings()
      if (
        !alive ||
        !active ||
        token !== generation ||
        recapGeneration !== state.generation ||
        !visible()
      )
        return
      activityKey = key(config, sessionId)
      currentConfig = config
      checkReturn(config)
    } catch (error) {
      if (alive && active && recapGeneration === state.generation) {
        publish(state, { ...state.value, error: errorMessage(error) })
      }
    }
  }

  function leave() {
    if (!active) return
    clearTimeout(retry)
    // Do not overwrite an unclaimed first visit while history is loading.
    if (read(activityKey) !== undefined) touch(activityKey)
    active = false
    generation++
  }

  function visibility() {
    if (visible()) void enter()
    else leave()
  }

  function activity() {
    if (!active || !visible() || !currentConfig) return
    void settings().then(
      (config) => {
        if (alive && active && visible()) {
          currentConfig = config
          checkReturn(config)
        }
      },
      () => {
        touch(activityKey)
      },
    )
  }

  const handlers: readonly (readonly [EventSource, string, () => void])[] = [
    [document, 'visibilitychange', visibility],
    [window, 'focus', enter],
    [window, 'blur', leave],
    [window, 'pagehide', leave],
    [document, 'pointerdown', activity],
    [document, 'keydown', activity],
  ]
  for (const [target, event, handler] of handlers) {
    target.addEventListener(event, handler)
  }
  void enter()

  // Keep leave-before-unsubscribe ordering identical to the mounted controller.
  return {
    leave,
    deactivate() {
      alive = false
    },
    removeHandlers() {
      for (const [target, event, handler] of handlers) {
        target.removeEventListener(event, handler)
      }
    },
  }
}
