import { publicUser, publicWorkspace } from './projections.js'

export function apiKeyFailure(value) {
  if (typeof value !== 'string' || value.length === 0 || value.trim().length === 0) {
    return 'Enter a Linear API key.'
  }
  const trimmed = value.trim()
  if (!/^[\x21-\x7e]+$/u.test(trimmed)) {
    return 'Use an unquoted API key containing printable characters only.'
  }
  if (
    /^[A-Za-z_][A-Za-z0-9_]*=/u.test(trimmed) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return 'Paste only the API key, without LINEAR_API_KEY= or surrounding quotes.'
  }
}

function storedWorkspace(config) {
  if (!config.organizationId) return null
  return {
    id: config.organizationId,
    name: config.organizationName || config.organizationId,
    urlKey: config.organizationUrlKey,
  }
}

// Effects are scoped to the Linear credential and workspace binding. The host
// adapter owns credential references, persistence namespaces, and RPC envelopes.
export function createLinearWorkspaceConnection(options) {
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

  const credentialStatus = async () => {
    if (fixedKey) return { configured: true, writable: false, source: 'composition' }
    const credentials = getCredentials()
    if (credentials === undefined) return { configured: false, writable: false }
    return credentials.describe()
  }

  const status = async () => ({
    credential: await credentialStatus(),
    workspace: storedWorkspace(readSettings()),
    viewer: null,
    live: false,
  })

  const bindWorkspace = (workspace) =>
    writeSettings({
      organizationId: workspace.id,
      organizationName: workspace.name,
      organizationUrlKey: workspace.urlKey,
    })

  const writableCredentials = async (operation) => {
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

  const test = async (signal) => {
    const live = await loadWorkspace(signal)
    if (!readSettings().organizationId) await bindWorkspace(live.workspace)
    return {
      ...(await status()),
      workspace: live.workspace,
      viewer: live.viewer,
      live: true,
    }
  }

  const connect = async (apiKey, signal) => {
    // Composition policy precedes validation; validation precedes storage access.
    if (fixedKey) {
      throw new Error('The Linear key is fixed by the composition and cannot be replaced here.')
    }
    const failure = apiKeyFailure(apiKey)
    if (failure !== undefined) throw new Error(failure)
    const credentials = await writableCredentials('replaced')
    const value = apiKey.trim()
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
