export const DEFAULT_MODEL = 'typesafe/jev-1.13'
export const CHANNEL = '/jev-integration'
export const ENDPOINT = 'https://openrouter.ai/api/alpha/decisions'
const LIMIT = 65536
const messages = {
  invalid: 'Invalid Jev request.',
  model: 'Invalid Jev model.',
  credential: 'OpenRouter credentials are unavailable.',
  network: 'Jev request failed.',
  response: 'Invalid Jev response.',
  timeout: 'Jev request timed out.',
  cancelled: 'Jev request cancelled.',
  stopped: 'Jev integration has stopped.',
  busy: 'Jev concurrency limit reached.',
  changed: 'Jev settings changed during the request.',
  settings: 'Jev settings are unavailable.',
}
export class JevError extends Error {
  constructor(code) {
    super(messages[code] ?? messages.network)
    this.name = 'JevError'
    this.code = code
    this.details = {}
  }
}
const fail = (code) => {
  throw new JevError(code)
}
const safe = (error) => (error instanceof JevError ? error : new JevError('network'))
export function validModel(model) {
  return (
    typeof model === 'string' &&
    model.length <= 128 &&
    (model === '~typesafe/jev-latest' ||
      /^typesafe\/jev-[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/u.test(model))
  )
}
const plain = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value))
const text = (value) => typeof value === 'string' && value.length > 0 && value.length <= 8192
const unit = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
const exact = (value, keys) =>
  plain(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((k) => Object.hasOwn(value, k))
// Copy JSON without invoking toJSON/getters, and bound traversal before encoding.
function snapshot(value) {
  let budget = LIMIT,
    nodes = 0
  const seen = new Set()
  function copy(v, depth) {
    if (++nodes > LIMIT || depth > 64) fail('invalid')
    if (v === null || typeof v === 'boolean') {
      budget -= 5
      return v
    }
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) fail('invalid')
      budget -= 24
      return v
    }
    if (typeof v === 'string') {
      budget -= Buffer.byteLength(v)
      if (budget < 0) fail('invalid')
      return v
    }
    if ((!plain(v) && !Array.isArray(v)) || seen.has(v)) fail('invalid')
    seen.add(v)
    const out = Array.isArray(v) ? [] : Object.create(null)
    const descriptors = Object.getOwnPropertyDescriptors(v)
    if (Reflect.ownKeys(descriptors).some((k) => typeof k !== 'string')) fail('invalid')
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (Array.isArray(v) && key === 'length') continue
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('invalid')
      if (Array.isArray(v) && (!/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= v.length))
        fail('invalid')
      budget -= Buffer.byteLength(key) + 4
      if (budget < 0) fail('invalid')
      out[key] = copy(descriptor.value, depth + 1)
    }
    if (Array.isArray(v) && Object.keys(out).length !== v.length) fail('invalid')
    seen.delete(v)
    return out
  }
  return copy(value, 0)
}
function prepare(input, model) {
  const data = snapshot({ state: input?.state, questions: input?.questions })
  if (!(typeof data.state === 'string' || plain(data.state) || Array.isArray(data.state)))
    fail('invalid')
  if (
    !plain(data.questions) ||
    Object.keys(data.questions).length < 1 ||
    Object.keys(data.questions).length > 32
  )
    fail('invalid')
  for (const [key, q] of Object.entries(data.questions)) {
    if (
      !key.length ||
      key.length > 128 ||
      !plain(q) ||
      !text(q.instructions) ||
      Object.keys(q).some((k) => !['type', 'instructions', 'criteria'].includes(k))
    )
      fail('invalid')
    if (q.type === 'noul') {
      if (
        q.criteria !== undefined &&
        (!exact(q.criteria, ['true', 'false']) || !Object.values(q.criteria).every(text))
      )
        fail('invalid')
    } else if (q.type === 'choice') {
      if (
        !plain(q.criteria) ||
        Object.keys(q.criteria).length < 1 ||
        Object.keys(q.criteria).length > 32 ||
        !Object.entries(q.criteria).every(([k, v]) => k.length > 0 && k.length <= 128 && text(v))
      )
        fail('invalid')
    } else if (q.type === 'score') {
      if (
        !Array.isArray(q.criteria) ||
        q.criteria.length < 1 ||
        q.criteria.length > 32 ||
        !q.criteria.every(text)
      )
        fail('invalid')
    } else fail('invalid')
  }
  const body = JSON.stringify({ model, state: data.state, questions: data.questions })
  if (Buffer.byteLength(body) > LIMIT) fail('invalid')
  return { body, questions: data.questions }
}
function probabilities(value, keys) {
  if (!exact(value, keys) || !Object.values(value).every(unit)) fail('response')
  if (Math.abs(Object.values(value).reduce((a, b) => a + b, 0) - 1) > 0.02) fail('response')
  return Object.fromEntries(keys.map((k) => [k, value[k]]))
}
function validateResponse(raw, questions, model) {
  if (
    !plain(raw) ||
    !validModel(raw.model) ||
    raw.model.startsWith('~') ||
    (model !== '~typesafe/jev-latest' &&
      raw.model !== model &&
      !raw.model.startsWith(`${model}-`)) ||
    !exact(raw.answers, Object.keys(questions))
  )
    fail('response')
  const answers = Object.create(null)
  for (const [key, q] of Object.entries(questions)) {
    const a = raw.answers[key]
    if (!plain(a) || a.type !== q.type) fail('response')
    if (q.type === 'noul') {
      if (!unit(a.noul)) fail('response')
      answers[key] = { type: 'noul', noul: a.noul }
    } else {
      if (!unit(a.confidence)) fail('response')
      const keys = Object.keys(q.criteria)
      const p = probabilities(a.probabilities, keys)
      if (q.type === 'choice') {
        if (typeof a.choice !== 'string' || !keys.includes(a.choice)) fail('response')
        answers[key] = {
          type: 'choice',
          choice: a.choice,
          confidence: a.confidence,
          probabilities: p,
        }
      } else {
        if (
          typeof a.score !== 'number' ||
          !Number.isFinite(a.score) ||
          a.score < 0 ||
          a.score > keys.length - 1 ||
          !exact(a.legend, keys) ||
          !keys.every((k) => a.legend[k] === q.criteria[k])
        )
          fail('response')
        answers[key] = {
          type: 'score',
          score: a.score,
          confidence: a.confidence,
          probabilities: p,
          legend: Object.fromEntries(keys.map((k) => [k, a.legend[k]])),
        }
      }
    }
  }
  const result = { model: raw.model, answers }
  if (raw.usage !== undefined) {
    if (!plain(raw.usage)) fail('response')
    result.usage = {}
    for (const key of ['input_tokens', 'output_tokens', 'cost']) {
      const value = raw.usage[key]
      if (value !== undefined) {
        if (
          typeof value !== 'number' ||
          !Number.isFinite(value) ||
          value < 0 ||
          (key !== 'cost' && !Number.isSafeInteger(value))
        )
          fail('response')
        result.usage[key] = value
      }
    }
  }
  return result
}
export function createJevRuntime({
  openrouter,
  settings,
  fetch: fetcher = globalThis.fetch,
  timeoutMs = 15000,
}) {
  let active = true,
    revision = 0
  const pending = new Set()
  function current() {
    try {
      const model = settings.get('jev')?.model ?? DEFAULT_MODEL
      if (!validModel(model)) fail('model')
      return { model }
    } catch (error) {
      throw error instanceof JevError ? error : new JevError('settings')
    }
  }
  function guard() {
    if (!active) fail('stopped')
  }
  async function status() {
    const { model } = current()
    let credential = { configured: false, writable: false, source: 'unavailable', target: null }
    try {
      const info = await openrouter.status()
      credential = {
        configured: info?.configured === true,
        writable: info?.writable === true,
        source: ['env', 'file', 'project-env', 'user-env', 'reference', 'none', 'record'].includes(
          info?.source,
        )
          ? info.source
          : 'unavailable',
      }
      if (info?.error) credential.error = messages.credential
    } catch {
      credential.error = messages.credential
    }
    return { model, available: active && credential.configured && !credential.error, credential }
  }
  async function evaluate(input) {
    let controller, timer, listener, reader, signal, response
    try {
      guard()
      signal = input?.signal
      if (signal?.aborted) fail('cancelled')
      if (pending.size >= 4) fail('busy')
      const { model } = current(),
        startRevision = revision
      const request = prepare(input, model)
      controller = new AbortController()
      pending.add(controller)
      const check = () => {
        if (controller.signal.aborted) throw controller.signal.reason
        guard()
        if (revision !== startRevision || current().model !== model) fail('changed')
      }
      const cancelled = new Promise((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
          once: true,
        })
      })
      listener = () => controller.abort(new JevError('cancelled'))
      signal?.addEventListener('abort', listener, { once: true })
      if (signal?.aborted) listener()
      timer = setTimeout(() => controller.abort(new JevError('timeout')), timeoutMs)
      const work = async () => {
        let key
        try {
          key = await openrouter.resolveApiKey()
        } catch {
          fail('credential')
        }
        check()
        if (typeof key !== 'string' || !/^[\x21-\x7e]{1,8192}$/u.test(key)) fail('credential')
        const fetching = fetcher(ENDPOINT, {
          method: 'POST',
          redirect: 'error',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: request.body,
          signal: controller.signal,
        })
        key = undefined
        response = await fetching
        if (controller.signal.aborted) {
          try {
            Promise.resolve(response?.body?.cancel()).catch(() => {})
          } catch {}
        }
        check()
        if (!response?.ok || response.redirected || (response.url && response.url !== ENDPOINT))
          fail('network')
        const size = response.headers?.get('content-length')
        if (size && Number(size) > LIMIT) fail('response')
        if (!response.body?.getReader) fail('response')
        reader = response.body.getReader()
        const chunks = []
        let bytes = 0
        while (true) {
          const chunk = await reader.read()
          check()
          if (chunk.done) break
          if (!(chunk.value instanceof Uint8Array)) fail('response')
          bytes += chunk.value.byteLength
          if (bytes > LIMIT) fail('response')
          chunks.push(chunk.value)
        }
        let raw
        try {
          raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
        } catch {
          fail('response')
        }
        check()
        return validateResponse(raw, request.questions, model)
      }
      return await Promise.race([work(), cancelled])
    } catch (error) {
      throw safe(error)
    } finally {
      clearTimeout(timer)
      try {
        signal?.removeEventListener?.('abort', listener)
      } catch {}
      if (controller) {
        pending.delete(controller)
        controller.abort(new JevError('cancelled'))
      }
      try {
        const cleanup = reader ? reader.cancel() : response?.body?.cancel()
        Promise.resolve(cleanup).catch(() => {})
      } catch {}
    }
  }
  return {
    service: Object.freeze({ evaluate, settings: current, status }),
    changed() {
      revision++
      for (const controller of pending) controller.abort(new JevError('changed'))
    },
    dispose() {
      active = false
      for (const controller of pending) controller.abort(new JevError('stopped'))
    },
    async rpc(endpoint, payload) {
      try {
        guard()
        if (endpoint === 'status') return { ok: true, value: await status() }
        if (endpoint !== 'configure' || !exact(payload, ['model']) || !validModel(payload.model))
          fail('invalid')
        const next = { model: payload.model }
        try {
          await settings.update('jev', next)
        } catch {
          fail('settings')
        }
        revision++
        for (const controller of pending) controller.abort(new JevError('changed'))
        guard()
        return { ok: true, value: await status() }
      } catch (error) {
        const e = safe(error)
        return { ok: false, error: { code: e.code, message: e.message, details: {} } }
      }
    },
  }
}
export function mountJev(ctx, schema, config = {}) {
  const runtime = createJevRuntime({ openrouter: ctx.openrouter, settings: ctx.settings })
  ctx.settings.installSection(
    ctx,
    'jev',
    schema,
    { model: DEFAULT_MODEL, ...config },
    {
      setSource() {},
      onChange() {
        runtime.changed()
      },
    },
  )
  ctx.provide('jev', runtime.service)
  ctx.effect(() => () => runtime.dispose())
  ctx.effect(() => ctx.connection.rpc.handle(CHANNEL, runtime.rpc, { authority: 'trusted-host' }))
  return runtime
}
