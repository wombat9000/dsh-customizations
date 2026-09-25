import { RecapError } from './errors.js'
import { generateRecap } from './generation.js'
import { boundedHistory } from './history.js'
import { LIMITS, normalizeSettings } from './settings.js'

// Preserve the host API while keeping pure helpers separate from runtime state.
export { RecapError } from './errors.js'
export { boundedHistory } from './history.js'
export { RECAP_PROMPT, parseCards, parseRecap } from './recap-schema.js'
export { DEFAULT_SETTINGS, LIMITS, normalizeSettings } from './settings.js'

export class RecapRuntime {
  constructor({ sessions, llm, settings, getJev = () => undefined, timeoutMs = LIMITS.timeoutMs }) {
    Object.assign(this, { sessions, llm, settings, getJev, timeoutMs })
    this.jevInstances = new WeakMap()
    this.nextJevInstance = 0
    this.cache = new Map()
    this.pending = new Map()
    this.controllers = new Set()
    this.disposed = false
  }

  dispose() {
    this.disposed = true
    for (const controller of this.controllers) controller.abort()
    this.cache.clear()
  }

  activity(payload) {
    if (
      !payload ||
      typeof payload.sessionId !== 'string' ||
      !payload.sessionId.trim() ||
      payload.sessionId.length > 256
    ) {
      throw new RecapError('invalid-request', 'Provide a valid session ID.')
    }
    const session = this.sessions.get(payload.sessionId)
    if (!session) return { ready: false, running: false, latestActivity: null }
    let running = false
    let latestActivity = null
    // These are restored log event times, not session metadata update times.
    for (const event of session.snapshotEvents()) {
      if (event.type === 'turn/start') running = true
      if (event.type === 'turn/end') running = false
      const conversation =
        event.type === 'turn/end' ||
        event.type === 'assistant/message' ||
        (event.type === 'user/message' && event.data.source?.kind === 'user')
      if (conversation && Number.isFinite(event.time) && event.time >= 0) {
        latestActivity = Math.max(latestActivity ?? 0, event.time)
      }
    }
    return { ready: true, running, latestActivity }
  }

  jevContext(settings) {
    if (!settings.useJev) return { identity: null }
    let service,
      instance = null
    try {
      service = this.getJev()
      if (!service || !['object', 'function'].includes(typeof service)) return { identity: null }
      if (!this.jevInstances.has(service)) this.jevInstances.set(service, ++this.nextJevInstance)
      instance = this.jevInstances.get(service)
      const model = service.settings()?.model
      if (typeof model !== 'string' || !model || typeof service.evaluate !== 'function') {
        return { identity: JSON.stringify([instance, null]) }
      }
      return { service, identity: JSON.stringify([instance, model]) }
    } catch {
      return { identity: instance === null ? null : JSON.stringify([instance, null]) }
    }
  }

  checkCurrent(sessionId, session, revision, settings, jev, signal) {
    if (signal?.aborted) throw new RecapError('cancelled', 'The recap request was cancelled.')
    if (
      this.disposed ||
      session.seq !== revision ||
      this.sessions.get(sessionId) !== session ||
      JSON.stringify(normalizeSettings(this.settings())) !== JSON.stringify(settings) ||
      this.jevContext(settings).identity !== jev.identity
    ) {
      throw new RecapError('stale', 'The session or recap settings changed. Request a fresh recap.')
    }
    if (session.snapshotEvents && this.activity({ sessionId }).running) {
      throw new RecapError(
        'session-running',
        'Wait until the agent finishes before requesting a recap.',
      )
    }
  }

  async recap(payload) {
    if (this.disposed) throw new RecapError('unavailable', 'Session Recap is unavailable.')
    if (
      !payload ||
      typeof payload.sessionId !== 'string' ||
      !payload.sessionId.trim() ||
      payload.sessionId.length > 256 ||
      (payload.automatic !== undefined && typeof payload.automatic !== 'boolean')
    ) {
      throw new RecapError('invalid-request', 'Provide a valid session ID.')
    }
    const settings = normalizeSettings(this.settings())
    if (payload.automatic && !settings.autoRecap) {
      throw new RecapError('auto-disabled', 'Automatic recaps are disabled.')
    }
    if (!settings.provider || !settings.model) {
      throw new RecapError(
        'not-configured',
        'Choose a provider and model in Settings → Plugins → Session Recap.',
      )
    }
    const session = this.sessions.get(payload.sessionId)
    if (!session) {
      throw new RecapError('session-unavailable', 'Open this session before requesting a recap.')
    }
    if (session.snapshotEvents && this.activity(payload).running) {
      throw new RecapError(
        'session-running',
        'Wait until the agent finishes before requesting a recap.',
      )
    }

    const revision = session.seq
    const jev = this.jevContext(settings)
    const key = JSON.stringify([payload.sessionId, revision, settings, jev.identity])
    const cached = this.cache.get(key)
    if (cached) return { ...cached, cached: true }
    if (this.pending.has(key)) return this.pending.get(key)
    if (this.pending.size >= LIMITS.concurrent) {
      throw new RecapError('busy', 'Too many recaps are running. Try again shortly.')
    }
    const history = boundedHistory(session.deriveMessages())
    if (!history.length) {
      throw new RecapError('empty-session', 'This session has no conversation text to recap.')
    }

    const promise = this.generate(payload.sessionId, revision, settings, history, session, jev)
      .then((value) => {
        this.checkCurrent(payload.sessionId, session, revision, settings, jev)
        if (!settings.useJev || value.selection.mode === 'jev') this.cache.set(key, value)
        while (this.cache.size > LIMITS.cacheEntries)
          this.cache.delete(this.cache.keys().next().value)
        return value
      })
      .finally(() => this.pending.delete(key))
    this.pending.set(key, promise)
    return promise
  }

  generate(sessionId, revision, settings, history, session, jev) {
    return generateRecap({ runtime: this, sessionId, revision, settings, history, session, jev })
  }
}
