import { DrivePermissions } from './permissions.js'

const EXPIRED = 'Drive access request is no longer active. Request access again.'
const LIMIT = 10 * 60 * 1000

// Browser methods never accept an Agent supplied over the wire. The registry
// resolves the current exact root, and each request retains that same identity.
export class DriveAccessRuntime {
  constructor({ client, googleAuth, agents, approval, onChange = () => {} }) {
    this.auth = googleAuth
    this.agents = agents
    this.approval = approval
    this.onChange = onChange
    this.records = new Map()
    this.committing = new Set()
    this.closed = false
    this.permissions = new DrivePermissions({ client,
      getAccountGeneration: () => googleAuth.getAccessGeneration(),
      isOwnerLive: owner => this.isLive(owner),
      onChange: owner => onChange(owner),
    })
    this.unsubscribe = googleAuth.onAccessChange(() => {
      this.permissions.invalidate()
      for (const record of this.records.values()) this.finish(record, 'cancelled')
    })
  }
  isLive(agent) {
    return !this.closed && !!agent?.session && this.agents.get(agent.session.id) === agent
      && this.agents.roots().includes(agent)
  }
  assertOwner(agent) {
    if (!this.isLive(agent)) throw new Error('Drive access requires the exact live top-level session; subagents do not inherit access.')
  }
  key(agent, callId) { return `${agent.session.id}:${callId}` }
  resolve(sessionId, callId) {
    if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 200
      || typeof callId !== 'string' || !callId || callId.length > 200) throw new Error(EXPIRED)
    const agent = this.agents.get(sessionId)
    this.assertOwner(agent)
    const record = this.records.get(this.key(agent, callId))
    if (!record || record.agent !== agent) throw new Error(EXPIRED)
    return record
  }
  requirePrompt(agent) {
    this.assertOwner(agent)
    if (!this.approval || (this.approval.overrideOf(agent.session) ?? this.approval.config?.policy ?? 'ask') !== 'ask') {
      throw new Error('Interactive Drive access is disabled by the session approval policy.')
    }
  }
  async connected() {
    const generation = this.auth.getAccessGeneration()
    const status = await this.auth.status()
    if (generation !== this.auth.getAccessGeneration()) throw new Error('Google account connection changed. Request access again.')
    if (!status.connected || !status.integrations.some(item => item.id === 'google-drive' && item.authorized)) {
      throw new Error('Connect Google Drive with read access in Settings → Plugins → Google accounts, then request session access again.')
    }
  }
  audit(record, action, resources) {
    // DSH 0.1.2-rc.1 refuses unknown persisted event types, but Session.append
    // cannot emit the required ignorable envelope marker. Keep informational
    // transition records local; grants are never reconstructed from an audit.
    const entries = record.audit ?? []
    record.audit = [...entries.slice(-19), {
      action, callId: record.callId,
      ...(resources ? { resources: resources.map(item => ({ id: item.id, recursive: item.recursive === true })) } : {}),
    }]
  }
  async request(agent, { callId, reason, signal }) {
    this.requirePrompt(agent)
    signal?.throwIfAborted()
    await this.connected()
    this.requirePrompt(agent)
    signal?.throwIfAborted()
    if (typeof callId !== 'string' || !callId || callId.length > 200) throw new Error('Drive access requires a tool call identity.')
    if ([...this.records.values()].some(item => item.agent === agent && item.state === 'pending')) {
      throw new Error('This session already has a pending Drive access request.')
    }
    const key = this.key(agent, callId)
    if (this.records.has(key)) throw new Error(EXPIRED)
    // Bound historical UI records; previous cards become inert, never authoritative.
    const settled = [...this.records.entries()].filter(([, item]) => item.agent === agent && item.state !== 'pending')
    for (const [oldKey] of settled.slice(0, Math.max(0, settled.length - 19))) this.records.delete(oldKey)
    const record = { agent, callId, reason, state: 'pending', requestId: this.permissions.request(agent).requestId }
    this.records.set(key, record)
    try { this.audit(record, 'requested') } catch (error) {
      this.permissions.cancel(agent, record.requestId)
      this.records.delete(key)
      throw error
    }
    const result = new Promise(resolve => { record.resolve = resolve })
    const cancel = () => this.finish(record, 'cancelled')
    signal?.addEventListener('abort', cancel, { once: true })
    record.cleanup = () => { signal?.removeEventListener('abort', cancel); clearTimeout(record.timer) }
    record.timer = setTimeout(cancel, LIMIT)
    record.timer.unref?.()
    if (signal?.aborted) cancel()
    return result
  }
  finish(record, state) {
    if (record.state !== 'pending') return
    if (state !== 'granted') {
      try { this.permissions.cancel(record.agent, record.requestId) } catch { /* Dead owner already denies access. */ }
    }
    record.state = state
    record.cleanup?.()
    const resources = state === 'granted' ? this.resources(record.agent) : []
    try { this.audit(record, state, state === 'granted' ? resources : undefined) }
    catch {
      // A grant without its audit record must never become usable.
      this.permissions.invalidate(record.agent)
      record.state = 'cancelled'
    }
    record.resolve?.({ state: record.state,
      ...(record.state === 'granted' ? { resources, skill: 'google-drive-read' } : {}) })
    record.resolve = undefined
    this.onChange(record.agent)
  }
  resources(agent) {
    try { return this.permissions.grants(agent).flatMap(grant => grant.resources).map(item => ({
      id: item.id, name: item.name, mimeType: item.mimeType, recursive: item.recursive === true,
    })) } catch { return [] }
  }
  status({ sessionId, callId }) {
    const record = this.resolve(sessionId, callId)
    const grants = this.resources(record.agent)
    return { state: record.state === 'granted' && !grants.length ? 'none' : record.state,
      ...(typeof record.reason === 'string' ? { reason: record.reason } : {}),
      ...(record.state === 'pending' ? { requestId: record.requestId } : {}), grants }
  }
  pending(input) {
    const record = this.resolve(input.sessionId, input.callId)
    this.requirePrompt(record.agent)
    if (record.state !== 'pending' || record.requestId !== input.requestId) throw new Error(EXPIRED)
    return record
  }
  async browse(input, signal) {
    const record = this.pending(input)
    return this.permissions.pickerList(record.agent, record.requestId, {
      parentId: input.parentId, search: input.search, pageToken: input.pageToken, pageSize: 50, signal,
    })
  }
  async grant(input, signal) {
    const record = this.pending(input)
    if (!Array.isArray(input.selected) || input.selected.length < 1 || input.selected.length > 100
      || input.selected.some(item => !item || typeof item.id !== 'string' || typeof item.recursive !== 'boolean'
        || Object.keys(item).some(key => !['id', 'recursive'].includes(key)))) throw new Error('Select between 1 and 100 files or folders.')
    if (this.committing.has(record.agent)) throw new Error('Drive access confirmation is already in progress.')
    this.committing.add(record.agent)
    try {
      await this.permissions.approve(record.agent, record.requestId, {
        fileIds: input.selected.filter(item => !item.recursive).map(item => item.id),
        folderIds: input.selected.filter(item => item.recursive).map(item => item.id),
        replace: true,
      }, { signal })
      try { this.pending(input) } catch (error) { this.permissions.invalidate(record.agent); throw error }
      this.finish(record, 'granted')
      return this.status(input)
    } catch (error) {
      this.finish(record, 'cancelled')
      throw error
    } finally {
      this.committing.delete(record.agent)
      this.onChange(record.agent)
    }
  }
  deny(input) {
    const record = this.pending(input)
    this.finish(record, 'denied')
    return this.status(input)
  }
  async manage(input) {
    const record = this.resolve(input.sessionId, input.callId)
    this.requirePrompt(record.agent)
    await this.connected()
    this.requirePrompt(record.agent)
    if (this.resolve(input.sessionId, input.callId) !== record) throw new Error(EXPIRED)
    if (record.state === 'pending') return this.status(input)
    if ([...this.records.values()].some(item => item.agent === record.agent && item.state === 'pending')) throw new Error('Another Drive request is already pending in this session.')
    record.requestId = this.permissions.request(record.agent).requestId
    record.state = 'pending'
    record.timer = setTimeout(() => this.finish(record, 'cancelled'), LIMIT)
    record.timer.unref?.()
    record.cleanup = () => clearTimeout(record.timer)
    try { this.audit(record, 'manage-requested') }
    catch (error) { this.finish(record, 'cancelled'); throw error }
    return this.status(input)
  }
  revoke(input) {
    const record = this.resolve(input.sessionId, input.callId)
    this.permissions.revoke(record.agent)
    for (const item of this.records.values()) if (item.agent === record.agent) this.finish(item, 'cancelled')
    this.audit(record, 'revoked')
    this.onChange(record.agent)
    return this.status(input)
  }
  release(agent) {
    for (const [key, record] of this.records) if (record.agent === agent) {
      this.finish(record, 'cancelled'); this.records.delete(key)
    }
    this.permissions.invalidate(agent)
  }
  dispose() {
    this.unsubscribe()
    for (const record of this.records.values()) this.finish(record, 'cancelled')
    this.closed = true
    this.permissions.dispose()
    this.records.clear()
  }
}
