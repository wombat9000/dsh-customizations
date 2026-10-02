import type {
  Owner,
  GoogleAuth,
  Agents,
  Approval,
  Dispose,
  FileOptions,
  ReadOptions,
  ListOptions,
  RequestOptions,
  BrowserInput,
  BrowserAction,
  BrowserRuntime,
} from './types.js'
import type { RouteContext } from './routes.js'
import type { SheetReadOptions, SheetPrepareOptions } from './sheets-runtime.js'
interface ServiceOptions {
  googleAuth?: GoogleAuth
  agents?: Agents
  approval?: Approval | undefined
  fetch?: typeof globalThis.fetch | undefined
}
interface HostContext extends RouteContext {
  googleAuth: GoogleAuth
  agents: Agents
  approval: Approval
  provide(name: 'googleDrive', service: GoogleDriveService): void
  on(event: 'agent/disposed', callback: (event: { agent: Owner }) => void): unknown
}
type AccessAction = 'status' | 'browse' | 'grant' | 'deny' | 'manage' | 'revoke'
import { DRIVE_SCOPE, GoogleDriveClient } from './google.js'
import { DriveAccessRuntime } from './runtime.js'
import { registerRoutes } from './routes.js'
import { GoogleSheetsClient, SHEETS_SCOPE } from './sheets.js'
import { SheetsRuntime } from './sheets-runtime.js'
import { SessionDriveTools } from './session-tools.js'

const ACCESS_ACTIONS: AccessAction[] = ['status', 'browse', 'grant', 'deny', 'manage', 'revoke']
const PREVIEW_ACTIONS = {
  'preview-status': 'status',
  'preview-apply': 'approve',
  'preview-deny': 'deny',
} as const
const BROWSER_ACTIONS: string[] = [
  ...ACCESS_ACTIONS,
  ...ACCESS_ACTIONS.map((action) => `edit-${action}`),
  ...Object.keys(PREVIEW_ACTIONS),
  'session-status',
  'session-set',
]

export const name = 'google-drive'
export const inject = ['googleAuth', 'agents', 'approval', 'webServer']

// Authentication and credential persistence belong to the shared Google service.
// The public Drive service has no account-wide list/read overload.
export class GoogleDriveService {
  #client
  #runtime: DriveAccessRuntime
  #editRuntime: DriveAccessRuntime
  #sheets
  #sheetsReadClient
  #sheetsWriteClient
  #observers = new Map<Owner, Set<Dispose>>()
  #sessionTools
  constructor({ googleAuth, agents, approval, fetch }: ServiceOptions = {}) {
    if (
      typeof googleAuth?.withAccessToken !== 'function' ||
      typeof googleAuth.getAccessGeneration !== 'function' ||
      typeof googleAuth.onAccessChange !== 'function'
    )
      throw new Error('The updated Google authentication service is required.')
    if (!agents) throw new Error('The session registry is required.')
    this.#client = new GoogleDriveClient({
      withAccessToken: (operation) => googleAuth.withAccessToken('google-drive', operation),
      fetch,
    })
    const onChange = (agent: Owner) => {
      // Permission lifetime signals invalidate previews on actual edit-grant
      // revisions. Merely opening an unrelated picker must not cancel a preview.
      for (const callback of this.#observers.get(agent) ?? []) callback()
    }
    const isEnabled = (agent: Owner) => this.#sessionTools?.isEnabled(agent) === true
    const enableRevision = (agent: Owner) => this.#sessionTools?.revisionOf(agent) ?? 0
    this.#runtime = new DriveAccessRuntime({
      client: this.#client,
      googleAuth,
      agents,
      approval,
      onChange,
      isEnabled,
      enableRevision,
    })
    this.#editRuntime = new DriveAccessRuntime({
      client: this.#client,
      googleAuth,
      agents,
      approval,
      onChange,
      isEnabled,
      enableRevision,
      mode: 'edit',
    })
    this.#sheetsReadClient = new GoogleSheetsClient({
      withAccessToken: (operation) => googleAuth.withAccessToken('google-drive', operation),
      fetch,
    })
    this.#sheetsWriteClient = new GoogleSheetsClient({
      withAccessToken: (operation) => googleAuth.withAccessToken('google-sheets-edit', operation),
      fetch,
    })
    this.#sheets = new SheetsRuntime({
      readRuntime: this.#runtime,
      editRuntime: this.#editRuntime,
      readClient: this.#sheetsReadClient,
      writeClient: this.#sheetsWriteClient,
      googleAuth,
    })
    this.#sessionTools = new SessionDriveTools({ service: this, agents })
  }
  assertOwner(agent: Owner) {
    this.#runtime.assertOwner(agent)
  }
  hasAccess(agent: Owner) {
    return !this.#runtime.committing.has(agent) && this.#runtime.resources(agent).length > 0
  }
  assertAccess(agent: Owner) {
    this.assertOwner(agent)
    if (!this.hasAccess(agent))
      throw new Error('This session has no committed Drive read permission.')
  }
  observe(agent: Owner, callback: Dispose) {
    this.assertOwner(agent)
    const set = this.#observers.get(agent) ?? new Set()
    this.#observers.set(agent, set)
    set.add(callback)
    return () => {
      set.delete(callback)
      if (!set.size) this.#observers.delete(agent)
    }
  }
  request(agent: Owner, args: RequestOptions) {
    return this.#runtime.request(agent, args)
  }
  async listFiles(agent: Owner, args: ListOptions) {
    this.assertAccess(agent)
    return this.#runtime.permissions.listFiles(agent, args)
  }
  async readText(agent: Owner, args: ReadOptions) {
    this.assertAccess(agent)
    return this.#runtime.permissions.readText(agent, args)
  }
  hasEditAccess(agent: Owner) {
    return !this.#editRuntime.committing.has(agent) && this.#editRuntime.resources(agent).length > 0
  }
  requestEdit(agent: Owner, args: RequestOptions) {
    return this.#editRuntime.request(agent, args)
  }
  describeSheets(agent: Owner, args: FileOptions) {
    return this.#sheets.describe(agent, args)
  }
  readSheet(agent: Owner, args: SheetReadOptions) {
    return this.#sheets.read(agent, args)
  }
  proposeSheetEdit(agent: Owner, args: SheetPrepareOptions) {
    return this.#sheets.prepare(agent, args)
  }
  // Browser-only dispatch stays separate from the model tool surface.
  browser(action: string, args: BrowserInput, signal?: AbortSignal) {
    if (!BROWSER_ACTIONS.includes(action)) throw new Error('Unknown Drive interaction.')
    if (action === 'session-status') return this.#sessionTools.status(args)
    if (action === 'session-set') return this.#sessionTools.set(args, signal)
    if (Object.hasOwn(PREVIEW_ACTIONS, action))
      return this.#sheets[PREVIEW_ACTIONS[action as keyof typeof PREVIEW_ACTIONS]](args, signal)
    if (action.startsWith('edit-'))
      return this.#editRuntime[action.slice(5) as AccessAction](args, signal)
    return this.#runtime[action as AccessAction](args, signal)
  }
  revokeSession(agent: Owner) {
    let failure
    for (const revoke of [
      () => this.#runtime.revokeOwner(agent),
      () => this.#editRuntime.revokeOwner(agent),
      () => this.#sheets.permissionsChanged(agent),
    ]) {
      try {
        revoke()
      } catch (error) {
        failure ??= error
      }
    }
    if (failure) throw failure
  }
  release(agent: Owner) {
    this.#sessionTools.release(agent)
    this.#sheets.release(agent)
    this.#runtime.release(agent)
    this.#editRuntime.release(agent)
    this.#observers.delete(agent)
  }
  dispose() {
    this.#sessionTools.dispose()
    this.#sheets.dispose()
    this.#runtime.dispose()
    this.#editRuntime.dispose()
    this.#client.dispose()
    this.#sheetsReadClient.dispose()
    this.#sheetsWriteClient.dispose()
    this.#observers.clear()
  }
}

export function apply(ctx: HostContext) {
  ctx.effect(() =>
    ctx.googleAuth.registerIntegration({
      id: 'google-drive',
      label: 'Google Drive',
      scopes: [DRIVE_SCOPE],
    }),
  )
  ctx.effect(() =>
    ctx.googleAuth.registerIntegration({
      id: 'google-sheets-edit',
      label: 'Google Sheets editing (account-wide)',
      scopes: [SHEETS_SCOPE],
    }),
  )
  const service = new GoogleDriveService({
    googleAuth: ctx.googleAuth,
    agents: ctx.agents,
    approval: ctx.approval,
  })
  ctx.effect(() => () => service.dispose())
  ctx.provide('googleDrive', service)
  ctx.on('agent/disposed', ({ agent }) => service.release(agent))
  const browser = Object.fromEntries(
    BROWSER_ACTIONS.map((action) => [
      action,
      (args: BrowserInput, signal?: AbortSignal) => service.browser(action, args, signal),
    ]),
  )
  registerRoutes(ctx, browser as BrowserRuntime)
}
