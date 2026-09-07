import { DRIVE_SCOPE, GoogleDriveClient } from './google.js'
import { DriveAccessRuntime } from './runtime.js'
import { registerRoutes } from './routes.js'
import { GoogleSheetsClient, SHEETS_SCOPE } from './sheets.js'
import { SheetsRuntime } from './sheets-runtime.js'
import { SessionDriveTools } from './session-tools.js'

const ACCESS_ACTIONS = ['status', 'browse', 'grant', 'deny', 'manage', 'revoke']
const PREVIEW_ACTIONS = { 'preview-status': 'status', 'preview-apply': 'approve', 'preview-deny': 'deny' }
const BROWSER_ACTIONS = [...ACCESS_ACTIONS, ...ACCESS_ACTIONS.map(action => `edit-${action}`), ...Object.keys(PREVIEW_ACTIONS), 'session-status', 'session-set']

export const name = 'google-drive'
export const inject = ['googleAuth', 'agents', 'approval', 'webServer']

// Authentication and credential persistence belong to the shared Google service.
// The public Drive service has no account-wide list/read overload.
export class GoogleDriveService {
  #client
  #runtime
  #editRuntime
  #sheets
  #sheetsReadClient
  #sheetsWriteClient
  #observers = new Map()
  #sessionTools
  constructor({ googleAuth, agents, approval, fetch } = {}) {
    if (typeof googleAuth?.withAccessToken !== 'function' || typeof googleAuth.getAccessGeneration !== 'function'
      || typeof googleAuth.onAccessChange !== 'function') throw new Error('The updated Google authentication service is required.')
    this.#client = new GoogleDriveClient({ withAccessToken: operation => googleAuth.withAccessToken('google-drive', operation), fetch })
    const onChange = agent => {
      // Permission lifetime signals invalidate previews on actual edit-grant
      // revisions. Merely opening an unrelated picker must not cancel a preview.
      for (const callback of this.#observers.get(agent) ?? []) callback()
    }
    const isEnabled = agent => this.#sessionTools?.isEnabled(agent) === true
    const enableRevision = agent => this.#sessionTools?.revisionOf(agent) ?? 0
    this.#runtime = new DriveAccessRuntime({ client: this.#client, googleAuth, agents, approval, onChange, isEnabled, enableRevision })
    this.#editRuntime = new DriveAccessRuntime({ client: this.#client, googleAuth, agents, approval, onChange, isEnabled, enableRevision, mode: 'edit' })
    this.#sheetsReadClient = new GoogleSheetsClient({ withAccessToken: operation => googleAuth.withAccessToken('google-drive', operation), fetch })
    this.#sheetsWriteClient = new GoogleSheetsClient({ withAccessToken: operation => googleAuth.withAccessToken('google-sheets-edit', operation), fetch })
    this.#sheets = new SheetsRuntime({ readRuntime: this.#runtime, editRuntime: this.#editRuntime,
      readClient: this.#sheetsReadClient, writeClient: this.#sheetsWriteClient, googleAuth })
    this.#sessionTools = new SessionDriveTools({ service: this, agents })
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
  hasEditAccess(agent) { return !this.#editRuntime.committing.has(agent) && this.#editRuntime.resources(agent).length > 0 }
  requestEdit(agent, args) { return this.#editRuntime.request(agent, args) }
  describeSheets(agent, args) { return this.#sheets.describe(agent, args) }
  readSheet(agent, args) { return this.#sheets.read(agent, args) }
  proposeSheetEdit(agent, args) { return this.#sheets.prepare(agent, args) }
  // Browser-only dispatch stays separate from the model tool surface.
  browser(action, args, signal) {
    if (!BROWSER_ACTIONS.includes(action)) throw new Error('Unknown Drive interaction.')
    if (action === 'session-status') return this.#sessionTools.status(args)
    if (action === 'session-set') return this.#sessionTools.set(args, signal)
    if (Object.hasOwn(PREVIEW_ACTIONS, action)) return this.#sheets[PREVIEW_ACTIONS[action]](args, signal)
    if (action.startsWith('edit-')) return this.#editRuntime[action.slice(5)](args, signal)
    return this.#runtime[action](args, signal)
  }
  revokeSession(agent) {
    let failure
    for (const revoke of [() => this.#runtime.revokeOwner(agent), () => this.#editRuntime.revokeOwner(agent), () => this.#sheets.permissionsChanged(agent)]) {
      try { revoke() } catch (error) { failure ??= error }
    }
    if (failure) throw failure
  }
  release(agent) {
    this.#sessionTools.release(agent)
    this.#sheets.release(agent); this.#runtime.release(agent); this.#editRuntime.release(agent); this.#observers.delete(agent)
  }
  dispose() {
    this.#sessionTools.dispose()
    this.#sheets.dispose(); this.#runtime.dispose(); this.#editRuntime.dispose()
    this.#client.dispose(); this.#sheetsReadClient.dispose(); this.#sheetsWriteClient.dispose(); this.#observers.clear()
  }
}

export function apply(ctx) {
  ctx.effect(() => ctx.googleAuth.registerIntegration({
    id: 'google-drive', label: 'Google Drive', scopes: [DRIVE_SCOPE],
  }))
  ctx.effect(() => ctx.googleAuth.registerIntegration({
    id: 'google-sheets-edit', label: 'Google Sheets editing (account-wide)', scopes: [SHEETS_SCOPE],
  }))
  const service = new GoogleDriveService({ googleAuth: ctx.googleAuth, agents: ctx.agents, approval: ctx.approval })
  ctx.effect(() => () => service.dispose())
  ctx.provide('googleDrive', service)
  ctx.on('agent/disposed', ({ agent }) => service.release(agent))
  const browser = Object.fromEntries(BROWSER_ACTIONS.map(action =>
    [action, (args, signal) => service.browser(action, args, signal)]))
  registerRoutes(ctx, browser)
}
