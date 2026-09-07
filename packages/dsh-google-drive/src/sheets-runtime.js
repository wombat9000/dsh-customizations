import { randomUUID } from 'node:crypto'

const SHEET = 'application/vnd.google-apps.spreadsheet'
const TTL = 10 * 60 * 1000
const ACTIVE = new Set(['preparing', 'pending', 'applying'])
const EXPIRED = 'Sheets preview is no longer active. Prepare a new preview.'
const UNCERTAIN = 'The write outcome is uncertain. Read the affected cells before preparing another change; do not retry this approval.'
const validIdentity = value => typeof value === 'string' && value.length > 0 && value.length <= 200
// Only owned, bounded JSON returned by GoogleSheetsClient reaches this helper.
const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
const freeze = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value) }
  return value
}

export class SheetsRuntime {
  #records = new Map()
  #proposals = new WeakMap()
  #closed = false
  constructor({ readRuntime, editRuntime, readClient, writeClient, googleAuth, onChange = () => {} }) {
    this.readRuntime = readRuntime
    this.editRuntime = editRuntime
    this.readClient = readClient
    this.writeClient = writeClient
    this.auth = googleAuth
    this.onChange = onChange
    this.unsubscribe = googleAuth.onAccessChange(() => this.permissionsChanged())
  }
  #owner(owner) {
    if (this.#closed) throw new Error(EXPIRED)
    this.editRuntime.assertOwner(owner)
    this.readRuntime.assertOwner(owner)
  }
  #explicit(owner, fileId) {
    if (this.editRuntime.committing.has(owner)) return false
    return this.editRuntime.permissions.grants(owner).some(grant => grant.resources.some(resource =>
      resource.id === fileId && resource.mimeType === SHEET && resource.recursive !== true))
  }
  #edit(owner, fileId) {
    this.#owner(owner)
    this.editRuntime.requirePrompt(owner)
    if (!this.#explicit(owner, fileId)) throw new Error('Select this spreadsheet for session edit access first.')
  }
  #read(owner, input, action) {
    this.#owner(owner)
    const runtime = this.#explicit(owner, input.fileId) ? this.editRuntime : this.readRuntime
    if (runtime.committing.has(owner)) throw new Error('Sheets access confirmation is still in progress.')
    const permissions = runtime.permissions
    return permissions.withAuthorized(owner, input, async (signal, check, file) => {
      if (file.mimeType !== SHEET) throw new Error('Select a Google spreadsheet.')
      const result = await action(signal)
      check()
      this.#owner(owner)
      if (runtime.committing.has(owner)) throw new Error('Sheets access confirmation is still in progress.')
      return result
    })
  }
  describe(owner, { fileId, signal, ...extra } = {}) {
    if (Object.keys(extra).length) throw new Error('Invalid Sheets describe options.')
    return this.#read(owner, { fileId, signal }, signal => this.readClient.describe({ fileId, signal }))
  }
  read(owner, { fileId, range, signal, ...extra } = {}) {
    if (Object.keys(extra).length) throw new Error('Invalid Sheets read options.')
    return this.#read(owner, { fileId, signal }, signal => this.readClient.read({ fileId, range, signal }))
  }
  #notify(owner) { try { this.onChange(owner) } catch { /* Notification failure must not change a write outcome. */ } }
  #key(owner, callId) { return `${owner.session.id}:${callId}` }
  #valid(record) {
    this.#edit(record.owner, record.fileId)
    if (record.generation !== this.auth.getAccessGeneration() || Date.now() >= record.expiresAt) throw new Error(EXPIRED)
    record.controller.signal.throwIfAborted()
    record.check?.()
  }
  #finish(record, state, result) {
    if (!ACTIVE.has(record.state)) return
    record.state = state
    record.result = result ?? { state }
    clearTimeout(record.timer)
    record.cleanup?.()
    record.permissionCleanup?.()
    this.#proposals.delete(record)
    record.resolve(record.result)
    record.resolve = () => {}
    this.#notify(record.owner)
  }
  #cancel(record) {
    record.preview = undefined
    record.controller.abort()
    // A dispatched operation must report its outcome, not lose it to a race.
    if (record.state !== 'applying') this.#finish(record, 'cancelled')
  }
  #bindPermission(record, signal, check) {
    record.permissionCleanup?.()
    record.check = check
    record.permissionSignal = signal
    const cancel = () => this.#cancel(record)
    signal.addEventListener('abort', cancel, { once: true })
    record.permissionCleanup = () => signal.removeEventListener('abort', cancel)
    if (signal.aborted) cancel()
  }
  prepare(owner, { callId, fileId, range, changes, signal, ...extra } = {}) {
    this.#edit(owner, fileId)
    if (Object.keys(extra).length || !validIdentity(callId) || (signal !== undefined && !(signal instanceof AbortSignal))) throw new Error('Invalid Sheets preview options.')
    signal?.throwIfAborted()
    const key = this.#key(owner, callId)
    if (this.#records.has(key)) throw new Error(EXPIRED)
    const records = [...this.#records.entries()].filter(([, record]) => record.owner === owner)
    if (records.filter(([, record]) => ACTIVE.has(record.state)).length >= 20) throw new Error('Too many pending Sheets previews.')
    while (records.length >= 20) {
      const index = records.findIndex(([, record]) => !ACTIVE.has(record.state))
      const [[oldKey]] = records.splice(index, 1)
      this.#records.delete(oldKey)
    }
    const record = { owner, callId, fileId, state: 'preparing', requestId: randomUUID(),
      generation: this.auth.getAccessGeneration(), expiresAt: Date.now() + TTL, controller: new AbortController() }
    const result = new Promise(resolve => { record.resolve = resolve })
    this.#records.set(key, record)
    const cancel = () => this.#cancel(record)
    signal?.addEventListener('abort', cancel, { once: true })
    record.cleanup = () => signal?.removeEventListener('abort', cancel)
    record.timer = setTimeout(cancel, TTL)
    record.timer.unref?.()
    this.#notify(owner)
    // Client prepare is read-only. Its permission race suppresses stale results.
    void this.editRuntime.permissions.withAuthorized(owner, { fileId, signal: record.controller.signal }, async (signal, check, file) => {
      if (file.mimeType !== SHEET) throw new Error('Select a Google spreadsheet.')
      this.#valid(record)
      this.#bindPermission(record, signal, check)
      record.fileName = file.name
      const proposal = await this.writeClient.prepare({ fileId, range, changes, signal })
      check()
      this.#valid(record)
      return proposal
    }).then(proposal => {
      if (record.state !== 'preparing') return
      this.#valid(record)
      if (proposal.fileId !== fileId) throw new Error('Invalid Sheets proposal.')
      // Preserve the exact client-issued identity; never reconstruct a proposal
      // from browser input. Freeze it defensively without copying live objects.
      this.#proposals.set(record, freeze(proposal))
      record.preview = freeze(copy({ fileId: proposal.fileId, fileName: record.fileName, range: proposal.range, tab: proposal.tab,
        before: proposal.before, after: proposal.after }))
      record.state = 'pending'
      this.#notify(owner)
    }).catch(error => {
      const message = error?.code === 'unsupported'
        ? 'This range contains unsupported cell features, such as merged cells, rich text, smart chips, or calculated outputs. Select a supported range and prepare again.'
        : error?.code === 'invalid'
          ? 'The requested range or changes are invalid or exceed the Sheets preview limits. Check the input and use a smaller range if needed.'
          : error?.code === 'noop'
            ? 'The requested values and supported formatting already match the spreadsheet. No write was prepared.'
            : 'Could not prepare the Sheets preview. Check access and the requested changes, then prepare again.'
      if (record.state === 'preparing') this.#finish(record, 'failed', { state: 'failed', message })
    })
    if (signal?.aborted) cancel()
    return result
  }
  #resolve({ sessionId, callId, requestId } = {}) {
    if (!validIdentity(sessionId) || !validIdentity(callId)) throw new Error(EXPIRED)
    const owner = this.editRuntime.agents.get(sessionId)
    this.#owner(owner)
    const record = this.#records.get(this.#key(owner, callId))
    if (!record || record.owner !== owner || (requestId !== undefined && requestId !== record.requestId)) throw new Error(EXPIRED)
    return record
  }
  status(input) {
    const record = this.#resolve(input)
    if (ACTIVE.has(record.state)) {
      try { this.#valid(record) } catch { this.#cancel(record) }
    } else {
      // Historical cards are not another way to retrieve revoked cell data.
      try { this.#edit(record.owner, record.fileId); record.check?.() } catch {
        record.preview = undefined
        record.result = { state: record.state, ...(record.state === 'uncertain' ? { message: UNCERTAIN } : {}) }
      }
    }
    return { state: record.state, requestId: record.requestId,
      ...(record.preview ? { preview: copy(record.preview) } : {}), ...(record.result ? { result: copy(record.result) } : {}) }
  }
  deny(input) {
    const record = this.#resolve(input)
    if (!input.requestId || !['preparing', 'pending'].includes(record.state)) throw new Error(EXPIRED)
    this.#valid(record)
    // Settle before aborting so cancellation and late preparation cannot
    // overwrite the user's explicit denial.
    this.#finish(record, 'denied')
    record.controller.abort()
    return this.status(input)
  }
  approve(input, signal) {
    if (signal !== undefined && !(signal instanceof AbortSignal)) throw new Error('Invalid cancellation signal.')
    const record = this.#resolve(input)
    if (!input.requestId || record.state !== 'pending') throw new Error(EXPIRED)
    try { this.#valid(record) } catch (error) { this.#cancel(record); throw error }
    // Consume synchronously, before any await: a duplicate can never dispatch.
    record.state = 'applying'
    this.#notify(record.owner)
    const cancel = () => this.#cancel(record)
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) cancel()
    return this.#apply(record).then(() => this.status(input))
      .finally(() => signal?.removeEventListener('abort', cancel))
  }
  async #apply(record) {
    let dispatched = false
    try {
      this.#valid(record)
      const proposal = this.#proposals.get(record)
      if (!proposal) throw new Error(EXPIRED)
      // Capture a fresh permission lifetime, but keep the write outside
      // withAuthorized's Promise.race so abort cannot conceal an uncertain write.
      await this.editRuntime.permissions.withAuthorized(record.owner,
        { fileId: record.fileId, signal: record.controller.signal }, async (signal, check, file) => {
          if (file.mimeType !== SHEET) throw new Error(EXPIRED)
          this.#valid(record)
          this.#bindPermission(record, signal, check)
        })
      this.#valid(record)
      const result = await this.writeClient.apply({ proposal, signal: record.permissionSignal,
        beforeDispatch: () => { this.#valid(record); dispatched = true } })
      if (result.status === 'uncertain') {
        this.#finish(record, 'uncertain', { state: 'uncertain', message: UNCERTAIN })
      } else if (result.status === 'applied' && dispatched) {
        this.#valid(record)
        this.#finish(record, 'applied', { state: 'applied', snapshot: copy(result.snapshot) })
      } else throw new Error('Invalid Sheets write result.')
    } catch (error) {
      if (dispatched) this.#finish(record, 'uncertain', { state: 'uncertain', message: UNCERTAIN })
      else this.#finish(record, 'failed', { state: 'failed', message: error?.code === 'stale'
        ? 'No write was dispatched. The spreadsheet changed after this preview was prepared. Read the affected cells and prepare a new preview.'
        : 'No write was dispatched. Access, approval, or spreadsheet contents changed. Prepare a new preview.' })
    }
  }
  permissionsChanged(owner) {
    for (const record of this.#records.values()) if (owner === undefined || record.owner === owner) {
      if (ACTIVE.has(record.state)) this.#cancel(record)
      else { record.preview = undefined; record.result = { state: record.state, ...(record.state === 'uncertain' ? { message: UNCERTAIN } : {}) } }
    }
  }
  release(owner) {
    for (const [key, record] of this.#records) if (record.owner === owner) {
      this.#cancel(record)
      this.#records.delete(key)
    }
  }
  dispose() {
    this.#closed = true
    this.unsubscribe()
    for (const record of this.#records.values()) this.#cancel(record)
    this.#records.clear()
  }
}
