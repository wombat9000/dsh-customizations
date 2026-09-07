import { DRIVE_SCOPE, GoogleDriveClient } from './google.js'
import { DriveAccessRuntime } from './runtime.js'
import { registerRoutes } from './routes.js'

export const name = 'google-drive'
export const inject = ['googleAuth', 'agents', 'approval', 'webServer']

// Authentication and credential persistence belong to the shared Google service.
// The public Drive service has no account-wide list/read overload.
export class GoogleDriveService {
  #client
  #runtime
  #observers = new Map()
  constructor({ googleAuth, agents, approval, fetch } = {}) {
    if (typeof googleAuth?.withAccessToken !== 'function' || typeof googleAuth.getAccessGeneration !== 'function'
      || typeof googleAuth.onAccessChange !== 'function') throw new Error('The updated Google authentication service is required.')
    this.#client = new GoogleDriveClient({ withAccessToken: operation => googleAuth.withAccessToken('google-drive', operation), fetch })
    this.#runtime = new DriveAccessRuntime({ client: this.#client, googleAuth, agents, approval,
      onChange: agent => {
        for (const callback of this.#observers.get(agent) ?? []) callback()
      },
    })
  }
  assertOwner(agent) { this.#runtime.assertOwner(agent) }
  hasAccess(agent) { return !this.#runtime.committing.has(agent) && this.#runtime.resources(agent).length > 0 }
  assertAccess(agent) {
    this.assertOwner(agent)
    if (!this.hasAccess(agent)) throw new Error('This session has no committed Drive read permission.')
  }
  observe(agent, callback) {
    this.assertOwner(agent)
    const set = this.#observers.get(agent) ?? new Set()
    this.#observers.set(agent, set); set.add(callback)
    return () => { set.delete(callback); if (!set.size) this.#observers.delete(agent) }
  }
  request(agent, args) { return this.#runtime.request(agent, args) }
  async listFiles(agent, args) { this.assertAccess(agent); return this.#runtime.permissions.listFiles(agent, args) }
  async readText(agent, args) { this.assertAccess(agent); return this.#runtime.permissions.readText(agent, args) }
  // Browser-only dispatch stays separate from the model tool surface.
  browser(action, args, signal) {
    if (!['status', 'browse', 'grant', 'deny', 'manage', 'revoke'].includes(action)) throw new Error('Unknown Drive interaction.')
    return this.#runtime[action](args, signal)
  }
  release(agent) { this.#runtime.release(agent); this.#observers.delete(agent) }
  dispose() { this.#runtime.dispose(); this.#client.dispose(); this.#observers.clear() }
}

export function apply(ctx) {
  ctx.effect(() => ctx.googleAuth.registerIntegration({
    id: 'google-drive', label: 'Google Drive', scopes: [DRIVE_SCOPE],
  }))
  const service = new GoogleDriveService({ googleAuth: ctx.googleAuth, agents: ctx.agents, approval: ctx.approval })
  ctx.effect(() => () => service.dispose())
  ctx.provide('googleDrive', service)
  ctx.on('agent/disposed', ({ agent }) => service.release(agent))
  const browser = Object.fromEntries(['status', 'browse', 'grant', 'deny', 'manage', 'revoke'].map(action =>
    [action, (args, signal) => service.browser(action, args, signal)]))
  registerRoutes(ctx, browser)
}
