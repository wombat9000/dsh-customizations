import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {
  JsonValue,
  JevQuestion,
  JevAnswer,
  JevRequest,
  JevResult,
  JevStatus,
  JevService,
  JevErrorCode,
  RpcResult,
} from '../shared/contracts.js'
export { CHANNEL } from '../shared/contracts.js'
import { CHANNEL } from '../shared/contracts.js'

// Only these two operations are consumed from the sibling OpenRouter service;
// credential metadata and resolved credentials remain untrusted until narrowed.
export interface OpenRouterService {
  status(): Promise<unknown>
  resolveApiKey(): Promise<unknown>
}
export interface RuntimeOptions {
  openrouter: OpenRouterService
  getModel(): unknown
  saveModel(model: string): Promise<unknown>
  fetch?: typeof globalThis.fetch
  timeoutMs?: number
}
interface QueueEntry {
  controller: AbortController
  resolve(): void
  running: boolean
}
export type JevContext = Context & {
  openrouter: OpenRouterService
  fiber: Context['fiber'] & { entry: { options: { id: string } } }
  // Loader emits this event for live volatile Config changes. Its published
  // declaration does not include this event in the borrowed RC2 graph.
  on(event: 'loader/volatile-update', callback: () => void): () => void
}
interface Connection {
  rpc: {
    handle(
      channel: string,
      handler: (endpoint: string, payload: unknown) => Promise<RpcResult<JevStatus>>,
      // RC2 admits operator requests natively; retain the existing registration
      // metadata even though the published declaration omits this legacy option.
      options: { authority: 'trusted-host' },
    ): () => Promise<void>
  }
}

export const DEFAULT_MODEL = 'typesafe/jev-1.13'
export const ENDPOINT = 'https://openrouter.ai/api/alpha/decisions'
const MAX_ACTIVE = 8
const MAX_WAITING = 32
// Byte/memory guards, not model token guarantees.
const MAX_SNAPSHOT_BYTES = 262144
const MAX_REQUEST_BYTES = 262144
const MAX_RESPONSE_BYTES = 65536
const MAX_TRAVERSAL_NODES = 65536
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
  code: JevErrorCode
  details: Record<string, never>
  constructor(code: JevErrorCode) {
    super(messages[code] ?? messages.network)
    this.name = 'JevError'
    this.code = code
    this.details = {}
  }
}
function fail(code: JevErrorCode): never {
  throw new JevError(code)
}
const safe = (error: unknown) => (error instanceof JevError ? error : new JevError('network'))
export function validModel(model: unknown): model is string {
  return (
    typeof model === 'string' &&
    model.length <= 128 &&
    (model === '~typesafe/jev-latest' ||
      /^typesafe\/jev-[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/u.test(model))
  )
}
function plain(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
}
const text = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 8192
const unit = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
const exact = (value: unknown, keys: string[]): value is Record<string, unknown> =>
  plain(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((k) => Object.hasOwn(value, k))
// Copy JSON without invoking toJSON/getters, and bound traversal before encoding.
function snapshot(value: unknown): JsonValue {
  let budget = MAX_SNAPSHOT_BYTES,
    nodes = 0
  const seen = new Set<object>()
  function copy(v: unknown, depth: number): JsonValue {
    if (++nodes > MAX_TRAVERSAL_NODES || depth > 64) fail('invalid')
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
    const out: JsonValue[] | Record<string, JsonValue> = Array.isArray(v) ? [] : Object.create(null)
    const descriptors = Object.getOwnPropertyDescriptors(v)
    if (Reflect.ownKeys(descriptors).some((k) => typeof k !== 'string')) fail('invalid')
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (Array.isArray(v) && key === 'length') continue
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('invalid')
      if (Array.isArray(v) && (!/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= v.length))
        fail('invalid')
      budget -= Buffer.byteLength(key) + 4
      if (budget < 0) fail('invalid')
      const value: unknown = descriptor.value
      if (Array.isArray(out)) out[Number(key)] = copy(value, depth + 1)
      else out[key] = copy(value, depth + 1)
    }
    if (Array.isArray(v) && Object.keys(out).length !== v.length) fail('invalid')
    seen.delete(v)
    return out
  }
  return copy(value, 0)
}
function prepare(input: JevRequest, model: string) {
  const data = snapshot({ state: input?.state, questions: input?.questions })
  if (!plain(data)) fail('invalid')
  if (!(typeof data.state === 'string' || plain(data.state) || Array.isArray(data.state)))
    fail('invalid')
  validateQuestions(data.questions)
  const body = JSON.stringify({ model, state: data.state, questions: data.questions })
  if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) fail('invalid')
  return { body, questions: data.questions }
}
function validateQuestions(questions: unknown): asserts questions is Record<string, JevQuestion> {
  if (!plain(questions) || Object.keys(questions).length < 1 || Object.keys(questions).length > 32)
    fail('invalid')
  for (const [key, q] of Object.entries(questions)) {
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
}
function probabilities(value: unknown, keys: string[]): Record<string, number> {
  if (!exact(value, keys)) fail('response')
  const probabilities: Record<string, number> = {}
  let sum = 0
  for (const key of keys) {
    const probability = value[key]
    if (!unit(probability)) fail('response')
    Object.defineProperty(probabilities, key, {
      value: probability,
      enumerable: true,
      writable: true,
      configurable: true,
    })
    sum += probability
  }
  if (Math.abs(sum - 1) > 0.02) fail('response')
  return probabilities
}
function validateResponse(
  raw: unknown,
  questions: Record<string, JevQuestion>,
  model: string,
): JevResult {
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
  const answers: Record<string, JevAnswer> = Object.create(null)
  // The exact-key check above narrows this response dictionary.
  const rawAnswers = raw.answers
  if (!plain(rawAnswers)) fail('response')
  for (const [key, q] of Object.entries(questions)) {
    const a = rawAnswers[key]
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
          !keys.every((k) => plain(a.legend) && a.legend[k] === q.criteria[Number(k)])
        )
          fail('response')
        answers[key] = {
          type: 'score',
          score: a.score,
          confidence: a.confidence,
          probabilities: p,
          legend: Object.fromEntries(
            q.criteria.map((description, index) => [String(index), description]),
          ),
        }
      }
    }
  }
  const result: JevResult = { model: raw.model, answers }
  if (raw.usage !== undefined) {
    if (!plain(raw.usage)) fail('response')
    result.usage = {}
    for (const key of ['input_tokens', 'output_tokens', 'cost'] as const) {
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
  getModel,
  saveModel,
  fetch: fetcher = globalThis.fetch,
  timeoutMs = 15000,
}: RuntimeOptions) {
  let active = true,
    revision = 0
  const pending = new Set<AbortController>()
  const waiting: QueueEntry[] = []
  let running = 0
  function drain() {
    while (active && running < MAX_ACTIVE && waiting.length) {
      const entry = waiting.shift()
      if (!entry) break
      if (entry.controller.signal.aborted) continue
      entry.running = true
      running++
      entry.resolve()
    }
  }
  function current() {
    try {
      const model = getModel()
      if (!validModel(model)) fail('model')
      return { model }
    } catch (error) {
      throw error instanceof JevError ? error : new JevError('settings')
    }
  }
  function guard() {
    if (!active) fail('stopped')
  }
  async function status(): Promise<JevStatus> {
    const { model } = current()
    let credential: JevStatus['credential'] = {
      configured: false,
      writable: false,
      source: 'unavailable',
      target: null,
    }
    try {
      const raw = await openrouter.status()
      const info = plain(raw) ? raw : undefined
      credential = {
        configured: info?.configured === true,
        writable: info?.writable === true,
        source: ['env', 'file', 'project-env', 'user-env', 'reference', 'none', 'record'].includes(
          typeof info?.source === 'string' ? info.source : '',
        )
          ? String(info?.source)
          : 'unavailable',
      }
      if (info?.error) credential.error = messages.credential
    } catch {
      credential.error = messages.credential
    }
    return { model, available: active && credential.configured && !credential.error, credential }
  }
  async function evaluate(input: JevRequest): Promise<JevResult> {
    let controller: AbortController | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let listener: (() => void) | undefined
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    let signal: AbortSignal | undefined
    let response: Response | undefined
    let entry: QueueEntry | undefined
    try {
      guard()
      signal = input?.signal
      if (signal?.aborted) fail('cancelled')
      if (running >= MAX_ACTIVE && waiting.length >= MAX_WAITING) fail('busy')
      const { model } = current(),
        startRevision = revision
      const request = prepare(input, model)
      const requestController = new AbortController()
      controller = requestController
      pending.add(controller)
      const check = () => {
        if (requestController.signal.aborted) throw requestController.signal.reason
        guard()
        if (revision !== startRevision || current().model !== model) fail('changed')
      }
      const cancelled = new Promise<never>((_, reject) => {
        requestController.signal.addEventListener(
          'abort',
          () => reject(requestController.signal.reason),
          {
            once: true,
          },
        )
      })
      listener = () => requestController.abort(new JevError('cancelled'))
      signal?.addEventListener('abort', listener, { once: true })
      if (signal?.aborted) listener()
      timer = setTimeout(() => requestController.abort(new JevError('timeout')), timeoutMs)
      const admitted = new Promise<void>((resolve) => {
        entry = { controller: requestController, resolve, running: false }
        waiting.push(entry)
        drain()
      })
      const work = async () => {
        await admitted
        // Admission can race cancellation or a settings change. Never resolve a
        // credential for stale work, even when an adapter ignores abort.
        check()
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
          signal: requestController.signal,
        })
        key = undefined
        response = await fetching
        if (requestController.signal.aborted) {
          try {
            Promise.resolve(response?.body?.cancel()).catch(() => {})
          } catch {}
        }
        check()
        if (!response?.ok || response.redirected || (response.url && response.url !== ENDPOINT))
          fail('network')
        const size = response.headers?.get('content-length')
        if (size && Number(size) > MAX_RESPONSE_BYTES) fail('response')
        if (!response.body?.getReader) fail('response')
        reader = response.body.getReader()
        const chunks: Uint8Array[] = []
        let bytes = 0
        while (true) {
          const chunk = await reader.read()
          check()
          if (chunk.done) break
          if (!(chunk.value instanceof Uint8Array)) fail('response')
          bytes += chunk.value.byteLength
          if (bytes > MAX_RESPONSE_BYTES) fail('response')
          chunks.push(chunk.value)
        }
        let raw: unknown
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
        if (listener) signal?.removeEventListener?.('abort', listener)
      } catch {}
      if (controller) {
        pending.delete(controller)
        controller.abort(new JevError('cancelled'))
      }
      try {
        const cleanup = reader ? reader.cancel() : response?.body?.cancel()
        Promise.resolve(cleanup).catch(() => {})
      } catch {}
      if (entry) {
        const index = waiting.indexOf(entry)
        if (index !== -1) waiting.splice(index, 1)
        // Only the outer evaluation owns its slot. Late adapter completion
        // cannot release it again or start another queued evaluation.
        if (entry.running) running--
        drain()
      }
    }
  }
  return {
    service: Object.freeze({ evaluate, settings: current, status }) satisfies JevService,
    changed() {
      revision++
      for (const controller of pending) controller.abort(new JevError('changed'))
    },
    dispose() {
      active = false
      for (const controller of pending) controller.abort(new JevError('stopped'))
    },
    async rpc(endpoint: string, payload?: unknown): Promise<RpcResult<JevStatus>> {
      try {
        guard()
        if (endpoint === 'status') return { ok: true, value: await status() }
        if (endpoint !== 'configure' || !exact(payload, ['model']) || !validModel(payload.model))
          fail('invalid')
        try {
          await saveModel(payload.model)
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
export function mountJev(ctx: JevContext, config: { model: { get(): unknown } }) {
  const runtime = createJevRuntime({
    openrouter: ctx.openrouter,
    getModel: () => config.model.get(),
    saveModel: (model) => {
      const settings = ctx.get('settings')
      if (!settings) fail('settings')
      return settings.update(ctx.fiber.entry.options.id, { model })
    },
  })
  ctx.on('loader/volatile-update', () => runtime.changed())
  ctx.inject(['settings'], (child) =>
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)),
  )
  ctx.provide('jev', runtime.service)
  ctx.effect(() => () => runtime.dispose())
  const connection: Connection = ctx.connection
  ctx.effect(() => connection.rpc.handle(CHANNEL, runtime.rpc, { authority: 'trusted-host' }))
  return runtime
}
