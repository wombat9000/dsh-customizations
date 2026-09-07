import z from '@deepseek-ai/schemastery'
import { GoogleOAuthClient, normalizeScopes } from './oauth.js'
import { registerSettingsRoutes } from './routes.js'

export const name = 'google-auth'
export const inject = ['credentials', 'webServer', 'settings']
export const CLIENT_KEY = 'google-auth/client'
export const CREDENTIAL_KEY = 'google-auth/default'
const CONFIG_ERROR = 'Configure a Google Desktop OAuth client in Settings → Plugins → Google accounts.'

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
    return value // Discard all supplied endpoints; OAuth uses fixed Google URLs.
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
      } catch { throw new Error('Could not read the Google credential store.') }
    },
    async set(tokens, isValid = () => true) {
      try {
        await provider.modifyRecord(CREDENTIAL_KEY, async () => {
          // The OAuth guard is evaluated under the store lock, at the commit
          // point. It rejects queued writes after cancellation/reconfiguration.
          if (!isCurrent() || !isValid()) throw new Error()
          return { kind: 'grant', payload: { version: 1, clientId, tokens } }
        })
      } catch { throw new Error('Could not save the Google credential store.') }
    },
    async delete() {
      try { await provider.deleteRecord(CREDENTIAL_KEY) }
      catch { throw new Error('Could not remove the Google credential store.') }
    },
  }
}

function integrationDefinition(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || typeof value.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/u.test(value.id)
    || typeof value.label !== 'string' || !value.label.trim() || value.label.length > 80
    || !Array.isArray(value.scopes) || value.scopes.length < 1 || value.scopes.length > 32
    || Array.from(value.scopes).some(scope => typeof scope !== 'string' || scope.length > 256
      || !(/^(openid|email|profile)$/u.test(scope) || /^https:\/\/www\.googleapis\.com\/auth\/[A-Za-z0-9._/-]+$/u.test(scope)))) {
    throw new Error('Register an integration ID, label, and explicit Google permission scopes.')
  }
  return Object.freeze({ id: value.id, label: value.label.trim(), scopes: Object.freeze(normalizeScopes(value.scopes).sort()) })
}

export class GoogleAuthService {
  constructor({ credentials, createClient = options => new GoogleOAuthClient(options) }) {
    this.credentials = credentials
    this.createClient = createClient
    this.client = undefined
    this.loading = undefined
    this.closed = false
    this.generation = 0
    this.mutation = Promise.resolve()
    this.integrations = new Map()
    this.pendingIntegrationId = undefined
    this.accessOperations = new Set()
  }

  invalidateAccess(integrationId) {
    for (const operation of this.accessOperations) {
      if (integrationId === undefined || operation.integration.id === integrationId) operation.controller.abort()
    }
  }

  registerIntegration(value) {
    if (this.closed) throw new Error('Google auth plugin has stopped.')
    const definition = integrationDefinition(value)
    if (this.integrations.has(definition.id)) throw new Error('Google integration ID is already registered.')
    if (this.integrations.size >= 32) throw new Error('Google integration registration limit reached.')
    this.integrations.set(definition.id, definition)
    // Registration is declaration only: no credential reads, login or consent.
    return () => {
      if (this.integrations.get(definition.id) !== definition) return
      this.integrations.delete(definition.id)
      this.invalidateAccess(definition.id)
      if (this.pendingIntegrationId === definition.id) {
        // A commit already underway may finish, but no removed integration can
        // obtain a token. Removing a plugin is not Google grant revocation.
        this.client?.cancel()
      }
    }
  }

  integration(id) {
    if (typeof id !== 'string' || !this.integrations.has(id)) throw new Error('Google integration is not registered.')
    return this.integrations.get(id)
  }

  assertIntegration(definition) {
    if (this.closed || this.integrations.get(definition.id) !== definition) throw new Error('Google integration changed; retry.')
  }

  async load() {
    if (this.closed) throw new Error('Google auth plugin has stopped.')
    if (this.client) return this.client
    if (!this.loading) {
      const generation = this.generation
      this.loading = (async () => {
        let record
        try { record = await this.credentials.readRecord(CLIENT_KEY) }
        catch { throw new Error('Could not read Google client configuration.') }
        if (this.closed || this.generation !== generation) throw new Error('Google configuration changed; retry.')
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
      if (this.closed) throw new Error('Google auth plugin has stopped.')
      return fn()
    })
    this.mutation = next.catch(() => {})
    return next
  }

  async resetClient() {
    this.invalidateAccess()
    this.generation++
    this.client?.dispose()
    this.client = undefined
    this.pendingIntegrationId = undefined
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
      } catch { throw new Error('Could not save Google client configuration.') }
      return {}
    })
  }

  async clearConfig() {
    return this.serialize(async () => {
      await this.resetClient()
      try { await this.credentials.deleteRecord(CLIENT_KEY) }
      catch { throw new Error('Could not remove Google client configuration.') }
      return {}
    })
  }

  async status() {
    await this.mutation
    let status
    try { status = await (await this.load()).status() }
    catch { status = { configured: false, connected: false, pending: false, grantedScopes: [], error: CONFIG_ERROR } }
    if (!status.pending) this.pendingIntegrationId = undefined
    const granted = new Set(status.connected ? status.grantedScopes : [])
    return {
      configured: status.configured === true, connected: status.connected === true, pending: status.pending === true,
      ...(Number.isFinite(status.expiresAt) ? { expiresAt: status.expiresAt } : {}),
      ...(status.error ? { error: status.error } : {}),
      ...(status.account ? { account: { id: status.account.id, ...(status.account.email ? { email: status.account.email } : {}) } } : {}),
      ...(status.pending && this.pendingIntegrationId ? { pendingIntegrationId: this.pendingIntegrationId } : {}),
      integrations: [...this.integrations.values()].map(integration => {
        const missingScopes = integration.scopes.filter(scope => !granted.has(scope))
        return { id: integration.id, label: integration.label, scopes: [...integration.scopes],
          authorized: status.connected === true && missingScopes.length === 0, missingScopes }
      }),
    }
  }

  async begin(integrationId) {
    const integration = this.integration(integrationId)
    return this.serialize(async () => {
      const client = await this.load()
      this.assertIntegration(integration)
      this.invalidateAccess()
      const result = await client.begin({ scopes: [...integration.scopes] })
      this.pendingIntegrationId = integration.id
      try { this.assertIntegration(integration) }
      catch (error) { client.cancel(); throw error }
      return result
    })
  }

  async cancel() {
    return this.serialize(() => {
      if (this.client?.cancel() === false) throw new Error('Google sign-in is finishing. Wait for completion, then disconnect if needed.')
      this.pendingIntegrationId = undefined
      return {}
    })
  }
  async disconnect() { return this.serialize(async () => { await this.resetClient(); return {} }) }

  // Trusted host consumers only. No unscoped overload, browser endpoint, token
  // export tool, or automatic login; missing permissions require a UI action.
  async getAccessToken(integrationId) {
    const integration = this.integration(integrationId)
    await this.mutation
    this.assertIntegration(integration)
    const client = await this.load()
    this.assertIntegration(integration)
    const token = await client.getAccessToken({ scopes: [...integration.scopes] })
    this.assertIntegration(integration)
    return token
  }

  // Keep downstream Google API work tied to the account lifecycle, not just
  // token issuance. The result cannot outlive disconnect/client replacement.
  async withAccessToken(integrationId, operation) {
    if (typeof operation !== 'function') throw new Error('Google access requires a host operation.')
    const integration = this.integration(integrationId)
    const controller = new AbortController()
    const entry = { integration, controller }
    this.accessOperations.add(entry)
    let onAbort
    const cancelled = new Promise((_resolve, reject) => {
      onAbort = () => reject(new Error('Google account access was cancelled.'))
      controller.signal.addEventListener('abort', onAbort, { once: true })
    })
    try {
      const work = (async () => {
        const token = await this.getAccessToken(integrationId)
        this.assertIntegration(integration)
        if (controller.signal.aborted) throw new Error('Google account access was cancelled.')
        const result = await operation(token, controller.signal)
        this.assertIntegration(integration)
        if (controller.signal.aborted) throw new Error('Google account access was cancelled.')
        return result
      })()
      return await Promise.race([work, cancelled])
    } finally {
      controller.signal.removeEventListener('abort', onAbort)
      controller.abort()
      this.accessOperations.delete(entry)
    }
  }

  dispose() {
    this.invalidateAccess()
    this.closed = true
    this.generation++
    this.client?.dispose()
    this.integrations.clear()
  }
}

export function apply(ctx) {
  const service = new GoogleAuthService({ credentials: ctx.credentials })
  ctx.effect(() => () => service.dispose())
  ctx.provide('googleAuth', service)
  registerSettingsRoutes(ctx, service)
  // Namespace existence makes the card discoverable. No credentials in settings.
  ctx.settings.installSection(ctx, name, z.object({}), {}, { setSource() {}, onChange() {} })
}
