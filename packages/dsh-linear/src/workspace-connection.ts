import type { LinearClient } from '@linear/sdk'
import type { LinearSettings } from './contracts.js'
import type { ConnectionStatus, CredentialStatus, Workspace, Viewer } from '../shared/rpc.js'
export interface WorkspaceConnectionOptions {
  getCredentials():
    | {
        describe(): Promise<CredentialStatus>
        set(value: string): Promise<unknown>
        unset(): Promise<unknown>
      }
    | undefined
  readSettings(): LinearSettings
  writeSettings(value: LinearSettings): Promise<unknown>
  emptySettings: LinearSettings
  loadWorkspace(signal?: AbortSignal): Promise<{ workspace: Workspace; viewer: Viewer }>
  createClient(apiKey: string, signal?: AbortSignal): Pick<LinearClient, 'organization' | 'viewer'>
  literalApiKey?: string | undefined
}
import { publicUser, publicWorkspace } from './projections.js'

import { apiKeyFailure } from '../shared/api-key.js'
export { apiKeyFailure } from '../shared/api-key.js'

function storedWorkspace(config: LinearSettings) {
  if (!config.organizationId) return null
  return {
    id: config.organizationId,
    name: config.organizationName || config.organizationId,
    urlKey: config.organizationUrlKey,
  }
}

// Effects are scoped to the Linear credential and workspace binding. The host
// adapter owns credential references, persistence namespaces, and RPC envelopes.
export function createLinearWorkspaceConnection(options: WorkspaceConnectionOptions) {
  const {
    getCredentials,
    readSettings,
    writeSettings,
    emptySettings,
    loadWorkspace,
    createClient,
    literalApiKey,
  } = options
  const fixedKey = typeof literalApiKey === 'string' && literalApiKey.length > 0

  const credentialStatus = async (): Promise<CredentialStatus> => {
    if (fixedKey) return { configured: true, writable: false, source: 'composition' }
    const credentials = getCredentials()
    if (credentials === undefined) return { configured: false, writable: false }
    return credentials.describe()
  }

  const status = async (): Promise<ConnectionStatus> => ({
    credential: await credentialStatus(),
    workspace: storedWorkspace(readSettings()),
    viewer: null,
    live: false,
  })

  const bindWorkspace = (workspace: Workspace) =>
    writeSettings({
      organizationId: workspace.id,
      organizationName: workspace.name,
      organizationUrlKey: workspace.urlKey,
    })

  const writableCredentials = async (operation: string) => {
    if (fixedKey) {
      throw new Error(`The Linear key is fixed by the composition and cannot be ${operation} here.`)
    }
    const credentials = getCredentials()
    if (credentials === undefined) throw new Error('DSH credential storage is unavailable.')
    const info = await credentials.describe()
    if (!info.writable) {
      throw new Error(
        `LINEAR_API_KEY is supplied by a read-only source and cannot be ${operation} here.`,
      )
    }
    return credentials
  }

  const test = async (signal?: AbortSignal) => {
    const live = await loadWorkspace(signal)
    if (!readSettings().organizationId) await bindWorkspace(live.workspace)
    return {
      ...(await status()),
      workspace: live.workspace,
      viewer: live.viewer,
      live: true,
    }
  }

  const connect = async (apiKey: unknown, signal?: AbortSignal) => {
    // Composition policy precedes validation; validation precedes storage access.
    if (fixedKey) {
      throw new Error('The Linear key is fixed by the composition and cannot be replaced here.')
    }
    const failure = apiKeyFailure(apiKey)
    if (failure !== undefined) throw new Error(failure)
    const credentials = await writableCredentials('replaced')
    // apiKeyFailure enforces a printable nonempty string before this point.
    const value = (apiKey as string).trim()
    const client = createClient(value, signal)
    const [organization, viewer] = await Promise.all([client.organization, client.viewer])
    const live = {
      workspace: publicWorkspace(organization),
      viewer: publicUser(viewer),
    }
    // Preserve partial-failure behavior: persist the probed key before its binding,
    // without retries or rollback if workspace persistence fails.
    await credentials.set(value)
    await bindWorkspace(live.workspace)
    return { ...(await status()), ...live, live: true }
  }

  const disconnect = async () => {
    const credentials = await writableCredentials('removed')
    await credentials.unset()
    await writeSettings({ ...emptySettings })
    return status()
  }

  return { status, test, connect, disconnect }
}
