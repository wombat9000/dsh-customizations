export const RECORD_KEY = 'llm-pi-ai/openrouter'
export const DEFAULT_REFERENCE = 'OPENROUTER_API_KEY'
export const CHANNEL = '/openrouter-integration'
const CANONICAL_URL = 'https://openrouter.ai/api/v1'
const SOURCE_NAMES = new Set(['env', 'file', 'project-env', 'user-env'])
const messages = {
  unavailable: 'OpenRouter credential storage is unavailable.',
  unsupported: 'The built-in OpenRouter route has an unsupported endpoint or credential kind.',
  stopped: 'OpenRouter integration has stopped.',
  changed: 'The OpenRouter credential target changed. Refresh status before trying again.',
  readonly: 'The selected OpenRouter credential source is read-only.',
  invalid: 'Invalid OpenRouter settings request.',
}
class SafeError extends Error {}
function fail(code) { throw new SafeError(messages[code]) }
function validRecord(record) {
  if (record !== undefined && (record?.kind !== 'api-key'
    || (record.key !== undefined && typeof record.key !== 'string'))) fail('unsupported')
}
function publicSource(info) {
  return SOURCE_NAMES.has(info.source) ? info.source : info.configured ? 'reference' : 'none'
}

// No external dependencies: host adapters supply the credential seam and settings.
export function createOpenRouterRuntime({ credentials, settings }) {
  let active = true
  const guard = () => { if (!active) fail('stopped') }
  const route = () => {
    guard()
    const profile = settings.get('llm-pi-ai')?.providers?.openrouter
    const baseURL = profile?.baseURL
    if (baseURL !== undefined && (typeof baseURL !== 'string'
      || baseURL.replace(/\/+$/u, '') !== CANONICAL_URL)) fail('unsupported')
    const ref = profile?.apiKeyEnv
    if (ref !== undefined && (typeof ref !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(ref))) fail('unsupported')
    return ref
  }
  async function select(recordOverride, hasOverride = false) {
    const initialRef = route()
    const result = await selectCurrent(recordOverride, hasOverride)
    if (route() !== initialRef) fail('changed')
    return result
  }
  async function selectCurrent(recordOverride, hasOverride = false) {
    const ref = route()
    if (ref !== undefined) {
      const info = await credentials.describe(ref)
      guard()
      return { configured: info.configured === true, writable: info.writable === true,
        source: publicSource(info), reference: ref, target: `reference:explicit:${ref}` }
    }
    const record = hasOverride ? recordOverride : await credentials.readRecord(RECORD_KEY)
    guard()
    validRecord(record)
    if (record?.key) {
      const info = await credentials.describeRecord(RECORD_KEY)
      guard()
      return { configured: true, writable: info.writable === true, source: 'record', target: `record:${RECORD_KEY}` }
    }
    const fallback = await credentials.describe(DEFAULT_REFERENCE)
    guard()
    if (fallback.configured === true) return { configured: true, writable: fallback.writable === true,
      source: publicSource(fallback), reference: DEFAULT_REFERENCE, target: `reference:default:${DEFAULT_REFERENCE}` }
    const info = await credentials.describeRecord(RECORD_KEY)
    guard()
    return { configured: false, writable: info.writable === true, source: 'none', target: `record:${RECORD_KEY}` }
  }
  async function safe(operation) {
    try { guard(); return await operation() }
    catch (error) { throw new SafeError(error instanceof SafeError ? error.message : messages.unavailable) }
  }
  async function status() {
    try { return await safe(select) }
    catch (error) { return { configured: false, writable: false, source: 'unavailable', target: null, error: error.message } }
  }
  async function resolveApiKey() {
    return safe(async () => {
      const selected = await select()
      const value = selected.reference !== undefined
        ? (await credentials.resolve(selected.reference))?.value
        : (await credentials.readRecord(RECORD_KEY))
      guard()
      // Refuse to return a value if settings changed during an asynchronous read.
      const current = await select()
      if (current.target !== selected.target) fail('changed')
      if (selected.reference !== undefined) return typeof value === 'string' && value.length ? value : undefined
      validRecord(value)
      return value?.key || undefined
    })
  }
  async function mutate(action, payload) {
    return safe(async () => {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)
        || Object.keys(payload).sort().join(',') !== (action === 'save' ? 'apiKey,target' : 'target')
        || typeof payload.target !== 'string') fail('invalid')
      if (action === 'save' && (typeof payload.apiKey !== 'string'
        || !/^[\x21-\x7e]{1,8192}$/u.test(payload.apiKey))) fail('invalid')
      const check = selected => {
        guard()
        if (selected.target !== payload.target) fail('changed')
        if (!selected.writable) fail('readonly')
      }
      const selected = await select()
      check(selected)
      if (selected.reference !== undefined) {
        check(await select())
        if (action === 'save') await credentials.set(selected.reference, payload.apiKey)
        else await credentials.unset(selected.reference)
      } else {
        // Clear only the key, preserving owner environment data. modifyRecord's
        // lock lets us reject unsupported grants and changed targets at commit.
        await credentials.modifyRecord(RECORD_KEY, async current => {
          validRecord(current)
          check(await select(current, true))
          return action === 'save' ? { ...current, kind: 'api-key', key: payload.apiKey }
            : { kind: 'api-key', ...(current?.env !== undefined ? { env: current.env } : {}) }
        })
      }
      guard()
      return status()
    })
  }
  return {
    service: Object.freeze({ resolveApiKey, status }),
    dispose() { active = false },
    async rpc(endpoint, payload) {
      try {
        guard()
        if (endpoint === 'status') return { ok: true, value: await status() }
        if (endpoint !== 'save' && endpoint !== 'clear') fail('invalid')
        return { ok: true, value: await mutate(endpoint, payload) }
      } catch (error) {
        return { ok: false, error: { message: error instanceof SafeError ? error.message : messages.unavailable } }
      }
    },
  }
}

export function mountOpenRouter(ctx, schema) {
  const runtime = createOpenRouterRuntime({ credentials: ctx.credentials, settings: ctx.settings })
  ctx.effect(() => () => runtime.dispose())
  ctx.provide('openrouter', runtime.service)
  ctx.settings.installSection(ctx, 'openrouter', schema, {}, { setSource() {}, onChange() {} })
  ctx.effect(() => ctx.connection.rpc.handle(CHANNEL, runtime.rpc, { authority: 'trusted-host' }))
  return runtime
}
