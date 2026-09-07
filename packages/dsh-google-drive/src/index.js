import z from '@deepseek-ai/schemastery'
import { GoogleDriveClient } from './google.js'
import { registerSettingsRoutes } from './routes.js'

export const name = 'google-drive'
export const inject = ['credentials', 'webServer', 'settings']
export const CREDENTIAL_KEY = 'google-drive/default'
export const CLIENT_KEY = 'google-drive/client'
const CONFIG_ERROR = 'Configure a Google Desktop OAuth client in Settings → Plugins → Google Drive.'

function validClient(value) {
  return value && typeof value.clientId === 'string'
    && /^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/u.test(value.clientId)
    && value.clientId.length <= 512
    && (value.clientSecret === undefined || (typeof value.clientSecret === 'string'
      && /^[\x21-\x7e]{1,1024}$/u.test(value.clientSecret)))
}

export function parseClientJson(text) {
  try {
    if (typeof text !== 'string' || text.length > 32768) throw new Error()
    const installed = JSON.parse(text)?.installed
    const value = { clientId: installed?.client_id,
      ...(installed?.client_secret !== undefined ? { clientSecret: installed.client_secret } : {}) }
    if (!validClient(value)) throw new Error()
    // Ignore all supplied endpoints: Google endpoints are fixed in google.js.
    return value
  } catch { throw new Error('Paste valid downloaded Google Desktop OAuth client JSON (maximum 32 KiB).') }
}

export function credentialAdapter(provider, clientId, isCurrent = () => true) {
  return {
    async get() {
      try {
        if (!isCurrent()) throw new Error()
        const record = await provider.readRecord(CREDENTIAL_KEY)
        if (!isCurrent()) throw new Error()
        if (record?.kind !== 'grant' || record.payload?.version !== 1
          || record.payload.clientId !== clientId) return undefined
        return record.payload.tokens
      } catch { throw new Error('Could not read the Google Drive credential store.') }
    },
    async set(tokens, isValid = () => true) {
      try {
        await provider.modifyRecord(CREDENTIAL_KEY, async () => {
          // Check inside the provider lock: a replaced client cannot resurrect
          // a token after configure/disconnect has removed the previous grant.
          if (!isCurrent() || !isValid()) throw new Error()
          return { kind: 'grant', payload: { version: 1, clientId, tokens } }
        })
      } catch { throw new Error('Could not save the Google Drive credential store.') }
    },
    async delete() {
      try { await provider.deleteRecord(CREDENTIAL_KEY) }
      catch { throw new Error('Could not remove the Google Drive credential store.') }
    },
  }
}

export class GoogleDriveService {
  constructor({ credentials, createClient = options => new GoogleDriveClient(options) }) {
    this.credentials = credentials
    this.createClient = createClient
    this.client = undefined
    this.loading = undefined
    this.closed = false
    this.generation = 0
    this.mutation = Promise.resolve()
  }

  async load() {
    if (this.closed) throw new Error('Google Drive plugin has stopped.')
    if (this.client) return this.client
    if (!this.loading) {
      const generation = this.generation
      this.loading = (async () => {
        let record
        try { record = await this.credentials.readRecord(CLIENT_KEY) }
        catch { throw new Error('Could not read Google Drive client configuration.') }
        if (this.closed || this.generation !== generation) throw new Error('Google Drive configuration changed; retry.')
        if (record?.kind !== 'grant' || record.payload?.version !== 1 || !validClient(record.payload)) throw new Error(CONFIG_ERROR)
        const { clientId, clientSecret } = record.payload
        this.client = this.createClient({ clientId, clientSecret,
          credentials: credentialAdapter(this.credentials, clientId, () => !this.closed && this.generation === generation),
        })
        return this.client
      })().finally(() => { this.loading = undefined })
    }
    return this.loading
  }

  serialize(fn) {
    const next = this.mutation.then(() => {
      if (this.closed) throw new Error('Google Drive plugin has stopped.')
      return fn()
    })
    this.mutation = next.catch(() => {})
    return next
  }

  async resetClient() {
    this.generation++
    this.client?.dispose()
    this.client = undefined
    if (this.loading) await this.loading.catch(() => {})
    await credentialAdapter(this.credentials, '').delete()
  }

  async configure(clientJson) {
    const config = parseClientJson(clientJson)
    return this.serialize(async () => {
      await this.resetClient()
      try {
        await this.credentials.modifyRecord(CLIENT_KEY, async () => {
          if (this.closed) throw new Error()
          return { kind: 'grant', payload: { version: 1, ...config } }
        })
      } catch { throw new Error('Could not save Google Drive client configuration.') }
      return {}
    })
  }

  async clearConfig() {
    return this.serialize(async () => {
      await this.resetClient()
      try { await this.credentials.deleteRecord(CLIENT_KEY) }
      catch { throw new Error('Could not remove Google Drive client configuration.') }
      return {}
    })
  }

  async status() {
    await this.mutation
    let client
    try { client = await this.load() }
    catch { return { configured: false, connected: false, pending: false, error: CONFIG_ERROR } }
    return client.status()
  }

  async begin() { return this.serialize(async () => (await this.load()).begin()) }
  async cancel() {
    return this.serialize(() => {
      if (this.client?.cancel() === false) throw new Error('Google sign-in is finishing. Wait for completion, then disconnect if needed.')
      return {}
    })
  }
  async disconnect() { return this.serialize(async () => { await this.resetClient(); return {} }) }
  async listFiles(args) { await this.mutation; return (await this.load()).listFiles(args) }
  // Host service only: deliberately absent from HTTP routes and model tools.
  // Future gws integration can pass this short-lived token to a child env only.
  async getAccessToken() { await this.mutation; return (await this.load()).getAccessToken() }
  dispose() { this.closed = true; this.generation++; this.client?.dispose() }
}

export function apply(ctx) {
  const service = new GoogleDriveService({ credentials: ctx.credentials })
  ctx.effect(() => () => service.dispose())
  ctx.provide('googleDrive', service)
  registerSettingsRoutes(ctx, service)
  // The Plugins tab renders only namespaces served by the Host. Keep this
  // schema empty: client JSON and tokens belong exclusively to credentials.
  ctx.settings.installSection(ctx, name, z.object({}), {}, { setSource() {}, onChange() {} })
}
