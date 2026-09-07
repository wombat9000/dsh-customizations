import { randomUUID } from 'node:crypto'

const FOLDER = 'application/vnd.google-apps.folder'
const SHORTCUT = 'application/vnd.google-apps.shortcut'
const idOK = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,256}$/u.test(id)
const fail = () => new Error('Google Drive permission is missing, stale, or revoked.')
const publicFile = file => {
  const { id, name, mimeType, size, modifiedTime, webViewLink } = file
  return { id, name, mimeType, ...(size === undefined ? {} : { size }),
    ...(modifiedTime === undefined ? {} : { modifiedTime }), ...(webViewLink === undefined ? {} : { webViewLink }) }
}

// Owners are stable live objects supplied by the host, never IDs received from a
// browser or model. The host validates the exact agent AND session in isOwnerLive.
export class DrivePermissions {
  #client
  #generation
  #live
  #change
  #states = new Map()
  #disposed = false
  constructor({ client, getAccountGeneration, isOwnerLive, onChange = () => {} } = {}) {
    if (!client || typeof getAccountGeneration !== 'function' || typeof isOwnerLive !== 'function' || typeof onChange !== 'function') throw new Error('Invalid Drive permission options.')
    this.#client = client
    this.#generation = getAccountGeneration
    this.#live = isOwnerLive
    this.#change = onChange
  }
  #clear(owner, state) {
    state.controller.abort()
    this.#states.delete(owner)
    this.#change(owner)
  }
  #state(owner) {
    const existing = this.#states.get(owner)
    const generation = this.#generation()
    if (existing && (existing.generation !== generation || !this.#live(owner))) this.#clear(owner, existing)
    if (this.#disposed || !owner || typeof owner !== 'object' || !this.#live(owner) || generation === undefined || generation === null) throw fail()
    if (!this.#states.has(owner)) this.#states.set(owner, { generation, controller: new AbortController(), requests: new Map(), grants: new Map(), cursors: new Map(), revision: 0 })
    return this.#states.get(owner)
  }
  #check(owner, state, revision = state.revision) {
    if (this.#state(owner) !== state || state.controller.signal.aborted || state.revision !== revision) throw fail()
  }
  #notify(owner, state) {
    state.revision++
    state.controller.abort()
    state.controller = new AbortController()
    state.cursors.clear()
    this.#change(owner)
  }
  request(owner) {
    const state = this.#state(owner)
    if (state.requests.size >= 20) throw new Error('Too many pending Google Drive requests.')
    const requestId = randomUUID()
    state.requests.set(requestId, { busy: false, controller: new AbortController() })
    this.#change(owner)
    return { requestId }
  }
  pending(owner) { return [...this.#state(owner).requests.keys()].map(requestId => ({ requestId })) }
  grants(owner) {
    return [...this.#state(owner).grants].map(([grantId, resources]) => ({ grantId, resources: resources.map(resource => ({ ...resource })) }))
  }
  #request(owner, requestId) {
    const state = this.#state(owner)
    const request = state.requests.get(requestId)
    if (!request || request.busy) throw fail()
    return { state, request }
  }
  deny(owner, requestId) {
    const state = this.#state(owner)
    const request = state.requests.get(requestId)
    if (!request) throw fail()
    request.controller.abort()
    state.requests.delete(requestId)
    this.#notify(owner, state)
  }
  cancel(owner, requestId) { this.deny(owner, requestId) }
  revoke(owner, grantId) {
    const state = this.#state(owner)
    if (grantId === undefined) {
      this.#clear(owner, state)
      return
    }
    if (!state.grants.delete(grantId)) throw fail()
    this.#notify(owner, state)
  }
  // Call this eagerly on account changes and session disposal. Lazy checks also
  // reject stale work even when the host misses an invalidation notification.
  invalidate(owner) {
    if (owner === undefined) {
      for (const [key, state] of [...this.#states]) this.#clear(key, state)
    } else {
      const state = this.#states.get(owner)
      if (state) this.#clear(owner, state)
    }
  }
  async #operation(owner, state, signal, action, request) {
    if (signal !== undefined && !(signal instanceof AbortSignal)) throw new Error('Invalid cancellation signal.')
    const combined = AbortSignal.any([state.controller.signal, ...(signal ? [signal] : []), ...(request ? [request.controller.signal] : [])])
    const revision = state.revision
    const check = () => {
      this.#check(owner, state, revision)
      if (combined.aborted) throw fail()
    }
    check()
    let abort
    const stopped = new Promise((_resolve, reject) => { abort = () => reject(fail()); combined.addEventListener('abort', abort, { once: true }) })
    try {
      const result = await Promise.race([Promise.resolve().then(() => action(combined, check)), stopped])
      check()
      return result
    } finally { combined.removeEventListener('abort', abort) }
  }
  #page(state, scope, pageToken) {
    if (pageToken === undefined) return undefined
    const cursor = state.cursors.get(pageToken)
    if (!cursor || cursor.scope !== scope) throw fail()
    return cursor.token
  }
  #cursor(state, scope, token) {
    if (!token) return {}
    if (state.cursors.size >= 200) state.cursors.delete(state.cursors.keys().next().value)
    const nextPageToken = randomUUID()
    state.cursors.set(nextPageToken, { scope, token })
    return { nextPageToken }
  }
  async pickerList(owner, requestId, { parentId, search, pageSize = 20, pageToken, signal, ...extra } = {}) {
    if (Object.keys(extra).length) throw new Error('Invalid picker options.')
    const { state, request } = this.#request(owner, requestId)
    const scope = JSON.stringify(['picker', requestId, parentId ?? null, search ?? null, pageSize])
    const token = this.#page(state, scope, pageToken)
    return this.#operation(owner, state, signal, async (signal, check) => {
      const result = await this.#client.pickerList({ parentId, search, pageSize, pageToken: token, signal })
      check()
      if (state.requests.get(requestId) !== request || request.busy) throw fail()
      return { files: result.files.filter(file => file.mimeType !== SHORTCUT).map(publicFile), ...this.#cursor(state, scope, result.nextPageToken) }
    }, request)
  }
  async approve(owner, requestId, { fileIds = [], folderIds = [], replace = false } = {}, { signal } = {}) {
    const { state, request } = this.#request(owner, requestId)
    if (typeof replace !== 'boolean' || (!replace && state.grants.size >= 100) || !Array.isArray(fileIds) || !Array.isArray(folderIds) || (!replace && fileIds.length + folderIds.length < 1)
      || fileIds.length + folderIds.length > 100 || ![...fileIds, ...folderIds].every(idOK)
      || new Set([...fileIds, ...folderIds]).size !== fileIds.length + folderIds.length) throw new Error('Invalid Google Drive selection.')
    request.busy = true
    try {
      const resources = await this.#operation(owner, state, signal, async (signal, check) => {
        const resources = []
        for (const id of [...fileIds, ...folderIds]) {
          const file = await this.#client.getMetadata({ fileId: id, signal })
          check()
          const recursive = folderIds.includes(id)
          if (file.id !== id || file.trashed !== false || file.mimeType === SHORTCUT || (file.mimeType === FOLDER) !== recursive) throw new Error('Invalid Google Drive selection.')
          resources.push({ ...publicFile(file), recursive })
        }
        return resources
      }, request)
      if (state.requests.get(requestId) !== request) throw fail()
      state.requests.delete(requestId)
      request.controller.abort()
      const grantId = randomUUID()
      if (replace) state.grants.clear()
      if (resources.length) state.grants.set(grantId, resources)
      this.#notify(owner, state)
      return { grantId, resources: resources.map(resource => ({ ...resource })) }
    } catch (error) {
      // Failed approvals are one-shot too; a retry requires a new visible request.
      if (state.requests.get(requestId) === request) {
        state.requests.delete(requestId)
        request.controller.abort()
        this.#change(owner)
      }
      throw error
    }
  }
  async #authorized(state, fileId, signal, check) {
    if (!idOK(fileId)) throw fail()
    const resources = [...state.grants.values()].flat()
    if (!resources.length) throw fail()
    const file = await this.#client.getMetadata({ fileId, signal })
    check()
    if (file.id !== fileId || file.trashed !== false || file.mimeType === SHORTCUT) throw fail()
    if (resources.some(resource => resource.id === fileId)) return file
    const roots = new Set(resources.filter(resource => resource.recursive).map(resource => resource.id))
    const queue = [...(file.parents ?? [])]
    const visited = new Set([fileId])
    let count = 0
    while (queue.length) {
      const id = queue.shift()
      if (visited.has(id)) continue
      visited.add(id)
      if (++count > 100) throw fail()
      const parent = await this.#client.getMetadata({ fileId: id, signal })
      check()
      if (parent.id !== id || parent.trashed !== false || parent.mimeType !== FOLDER) throw fail()
      if (roots.has(id)) return file
      queue.push(...(parent.parents ?? []))
    }
    throw fail()
  }
  async getMetadata(owner, { fileId, signal, ...extra } = {}) {
    if (Object.keys(extra).length) throw new Error('Invalid Google Drive metadata options.')
    const state = this.#state(owner)
    return this.#operation(owner, state, signal, async (signal, check) => publicFile(await this.#authorized(state, fileId, signal, check)))
  }
  async readText(owner, { fileId, maxBytes, signal, ...extra } = {}) {
    if (Object.keys(extra).length) throw new Error('Invalid Google Drive read options.')
    const state = this.#state(owner)
    return this.#operation(owner, state, signal, async (signal, check) => {
      await this.#authorized(state, fileId, signal, check)
      const result = await this.#client.readText({ fileId, maxBytes, signal })
      check()
      const file = await this.#authorized(state, fileId, signal, check)
      return { ...result, file: publicFile(file) }
    })
  }
  async listFiles(owner, { folderId, pageSize = 20, pageToken, signal, ...extra } = {}) {
    if (Object.keys(extra).length || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('Invalid Google Drive list options.')
    const state = this.#state(owner)
    const scope = JSON.stringify(['agent', folderId ?? null, pageSize])
    const token = this.#page(state, scope, pageToken)
    return this.#operation(owner, state, signal, async (signal, check) => {
      if (folderId === undefined) {
        const resources = [...new Map([...state.grants.values()].flat().map(resource => [resource.id, resource])).values()]
        const offset = token ?? 0
        const files = []
        for (const resource of resources.slice(offset, offset + pageSize)) files.push(publicFile(await this.#authorized(state, resource.id, signal, check)))
        check()
        return { files, ...this.#cursor(state, scope, offset + pageSize < resources.length ? offset + pageSize : undefined) }
      }
      const folder = await this.#authorized(state, folderId, signal, check)
      if (folder.mimeType !== FOLDER) throw fail()
      const result = await this.#client.listFolder({ folderId, pageSize, pageToken: token, signal })
      check()
      const files = []
      for (const child of result.files) {
        if (child.mimeType === SHORTCUT) continue
        // Re-fetch each child: do not trust list IDs or cached ancestry.
        const file = await this.#authorized(state, child.id, signal, check)
        if (!file.parents?.includes(folderId)) throw fail()
        files.push(publicFile(file))
      }
      await this.#authorized(state, folderId, signal, check)
      check()
      return { files, ...this.#cursor(state, scope, result.nextPageToken) }
    })
  }
  dispose() { this.#disposed = true; this.invalidate() }
}
