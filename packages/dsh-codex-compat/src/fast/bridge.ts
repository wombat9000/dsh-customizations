import { AsyncLocalStorage } from 'node:async_hooks'
import { createRequire, findPackageJSON } from 'node:module'
import { pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'
import type { GenerateOptions, LlmRuntime, StreamChunk } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { isObject } from '../../shared/contracts.js'

// Read installed package metadata only. No profile files, credentials or provider calls.
const verifiedRuntime = (() => {
  try {
    const require = createRequire(import.meta.url)
    const adapterPath = require.resolve('@deepseek-ai/dsh-llm-pi-ai/package.json')
    const adapter: unknown = JSON.parse(readFileSync(adapterPath, 'utf8'))
    const piPath = findPackageJSON('@earendil-works/pi-ai', pathToFileURL(adapterPath))
    if (!piPath) return false
    const pi: unknown = JSON.parse(readFileSync(piPath, 'utf8'))
    return (
      isObject(adapter) &&
      adapter.version === '0.2.0-rc.2' &&
      isObject(pi) &&
      pi.version === '0.87.1'
    )
  } catch {
    return false
  }
})()

// Reviewed against OpenAI's Codex speed documentation; not an entitlement claim.
const MODELS = new Set([
  'gpt-5.4',
  'gpt-5.5',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-6-astra',
  'gpt-6-sol',
  'gpt-6-luna',
  'gpt-6.1-sol',
])
export const supportsFast = (provider: string, model: string) =>
  provider === 'openai-codex' && MODELS.has(model)
const BRIDGE_ERROR =
  'Codex Fast integration is incompatible. Disable the integration in Plugins → Codex Fast to use Standard inference.'
export class FastBridgeError extends Error {
  constructor() {
    super(BRIDGE_ERROR)
  }
}
interface Model {
  provider: string
  id: string
  api: string
  baseUrl: string
}
interface Options {
  sessionId?: string
  onPayload?: (payload: unknown, model: Model) => unknown | Promise<unknown>
  [key: string]: unknown
}
interface Lease {
  options: GenerateOptions
  epoch: number
  sent: boolean
  live(): boolean
  report(): void
}
type Method = (this: object, ...args: unknown[]) => unknown
interface Patch {
  owner: WeakRef<object>
  name: string
  descriptor: PropertyDescriptor | undefined
  wrapper: Method
}
function method(owner: object, name: string): Method {
  const value: unknown = Reflect.get(owner, name)
  if (typeof value !== 'function') throw new FastBridgeError()
  return value as Method
}
function plain(value: unknown): value is Record<string, unknown> {
  return (
    isObject(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  )
}

/** Owns the sole private escape hatch. Never changes registries, prototypes or provider Config. */
export class CodexFastBridge {
  private readonly scope = new AsyncLocalStorage<Lease | null>()
  private readonly patched = new WeakMap<object, Map<string, Method>>()
  private readonly patches = new Set<Patch>()
  private readonly seenAdapters = new WeakSet<PiAiAdapter>()
  private readonly adapters = new Set<WeakRef<PiAiAdapter>>()
  private epoch = 0
  private enabled = false
  private readonly llm: LlmRuntime
  constructor(llm: LlmRuntime) {
    this.llm = llm
  }

  private adapter(): PiAiAdapter {
    if (!verifiedRuntime) throw new FastBridgeError()
    // DSH 0.2.0-rc.2 has no public adapter lookup. Validate before touching this private map.
    const registry: unknown = Reflect.get(this.llm, 'adapters')
    if (!(registry instanceof Map)) throw new FastBridgeError()
    const entry: unknown = registry.get('openai-codex')
    if (!isObject(entry) || !(entry.adapter instanceof PiAiAdapter)) throw new FastBridgeError()
    return entry.adapter
  }
  supports(provider: string, model: string): boolean {
    if (!supportsFast(provider, model)) return false
    try {
      const adapter = this.adapter()
      const snapshot = method(adapter, 'current').call(adapter)
      const resolved = method(adapter, 'modelOf').call(adapter, snapshot, provider, model)
      return (
        isObject(resolved) &&
        resolved.api === 'openai-codex-responses' &&
        resolved.baseUrl === 'https://chatgpt.com/backend-api'
      )
    } catch {
      return false
    }
  }
  private patch(owner: object, name: string, wrap: (original: Method) => Method) {
    const known = this.patched.get(owner)?.get(name)
    if (known) {
      if (Reflect.get(owner, name) !== known) throw new FastBridgeError()
      return
    }
    const original = method(owner, name)
    const descriptor = Object.getOwnPropertyDescriptor(owner, name)
    const wrapper = wrap(original)
    Object.defineProperty(owner, name, { configurable: true, writable: true, value: wrapper })
    const names = this.patched.get(owner) ?? new Map<string, Method>()
    names.set(name, wrapper)
    this.patched.set(owner, names)
    this.patches.add({ owner: new WeakRef(owner), name, descriptor, wrapper })
  }
  private instrument(adapter: PiAiAdapter) {
    const bridge = this
    this.patch(
      adapter,
      'streamWithSnapshot',
      (original) =>
        function (...args) {
          const lease = bridge.scope.getStore()
          if (bridge.valid(lease)) {
            const snapshot = args[1]
            if (!isObject(snapshot) || !isObject(snapshot.models)) throw new FastBridgeError()
            bridge.instrumentModels(snapshot.models)
          }
          return original.apply(this, args)
        },
    )
    // Probe the current snapshot without resolving credentials or making a request.
    const snapshot = method(adapter, 'current').call(adapter)
    if (!isObject(snapshot) || !isObject(snapshot.models)) throw new FastBridgeError()
    method(snapshot.models, 'streamSimple')
  }
  private valid(lease: Lease | null | undefined): lease is Lease {
    return (
      !!lease &&
      this.enabled &&
      lease.epoch === this.epoch &&
      lease.live() &&
      !lease.options.signal?.aborted
    )
  }
  private instrumentModels(models: object) {
    const bridge = this
    this.patch(
      models,
      'streamSimple',
      (original) =>
        function (...args) {
          const lease = bridge.scope.getStore()
          if (!bridge.valid(lease)) return original.apply(this, args)
          const [rawModel, context, rawOptions] = args
          if (
            !isObject(rawModel) ||
            !isObject(rawOptions) ||
            rawModel.provider !== lease.options.provider ||
            rawModel.id !== lease.options.model ||
            rawModel.api !== 'openai-codex-responses' ||
            rawOptions.sessionId !== lease.options.sessionId ||
            rawModel.baseUrl !== 'https://chatgpt.com/backend-api'
          )
            throw new FastBridgeError()
          const previous = rawOptions.onPayload
          if (previous !== undefined && typeof previous !== 'function') throw new FastBridgeError()
          const options: Options = {
            ...rawOptions,
            // Codex caches WebSocket continuations by session. Never reuse Standard's continuation for Fast.
            sessionId: `${String(rawOptions.sessionId)}:dsh-codex-fast-v1`,
            onPayload: async (payload, model) => {
              const replacement: unknown = previous ? await previous(payload, model) : undefined
              const body = replacement === undefined ? payload : replacement
              // The adapter combines cancellation with its own idle/consumer watchdog.
              if (rawOptions.signal instanceof AbortSignal && rawOptions.signal.aborted)
                throw rawOptions.signal.reason
              // Revoke pending callbacks BEFORE a request is serialized on integration/session disable.
              if (!bridge.valid(lease)) return body
              if (
                !plain(body) ||
                body.model !== lease.options.model ||
                (body.service_tier !== undefined &&
                  body.service_tier !== 'priority' &&
                  body.service_tier !== 'fast' &&
                  body.service_tier !== 'default' &&
                  body.service_tier !== 'auto')
              )
                throw new FastBridgeError()
              lease.sent = true
              lease.report() // caller owns a nonthrowing, nonsecret diagnostic sink.
              return { ...body, service_tier: 'priority' }
            },
          }
          return original.call(this, rawModel, context, options)
        },
    )
  }
  /** Remember identities while off without modifying any method or request. */
  observe() {
    try {
      const adapter = this.adapter()
      if (!this.seenAdapters.has(adapter)) {
        this.seenAdapters.add(adapter)
        this.adapters.add(new WeakRef(adapter))
      }
      if (this.enabled) this.instrument(adapter)
    } catch {
      /* A dormant/missing provider must never break its registration event. */
    }
  }
  enable() {
    this.adapter() // Do not advertise a retired route as a live capability.
    this.observe()
    if (!this.enabled) {
      this.enabled = true
      this.epoch++
    }
    try {
      for (const reference of this.adapters) {
        const adapter = reference.deref()
        if (adapter) this.instrument(adapter)
        else this.adapters.delete(reference)
      }
    } catch (error) {
      this.disable()
      throw error
    }
  }
  check(): boolean {
    if (!this.enabled) return false
    try {
      this.instrument(this.adapter())
      return true
    } catch {
      return false
    }
  }
  disable() {
    this.enabled = false
    this.epoch++
    for (const patch of [...this.patches].reverse()) {
      const owner = patch.owner.deref()
      if (owner && Reflect.get(owner, patch.name) === patch.wrapper) {
        if (patch.descriptor) Object.defineProperty(owner, patch.name, patch.descriptor)
        else Reflect.deleteProperty(owner, patch.name)
      }
      if (owner) this.patched.delete(owner)
    }
    this.patches.clear()
  }
  /** Bind construction AND iterator operations. A null scope shadows outer Fast calls. */
  stream(
    options: GenerateOptions,
    next: () => AsyncIterable<StreamChunk>,
    target: { live(): boolean; report(): void } | null,
  ): AsyncIterable<StreamChunk> {
    const bridge = this
    const lease: Lease | null = target
      ? { options, epoch: this.epoch, sent: false, ...target }
      : null
    return {
      [Symbol.asyncIterator]() {
        let iterator: AsyncIterator<StreamChunk> | undefined
        let failed = false
        const run = <T>(operation: () => T) => bridge.scope.run(lease, operation)
        const get = () => (iterator ??= run(() => next()[Symbol.asyncIterator]()))
        return {
          async next() {
            const result = await run(() => get().next())
            if (
              !result.done &&
              result.value.type === 'finish' &&
              (result.value.reason.kind === 'error' || result.value.reason.kind === 'aborted')
            )
              failed = true
            if (result.done && !failed && bridge.valid(lease) && !lease.sent)
              throw new FastBridgeError()
            return result
          },
          async return(value?: unknown) {
            return run(
              () =>
                get().return?.(value) ?? Promise.resolve({ done: true as const, value: undefined }),
            )
          },
          async throw(error?: unknown) {
            return run(() => {
              const active = get()
              if (active.throw) return active.throw(error)
              throw error
            })
          },
        }
      },
    }
  }
}
