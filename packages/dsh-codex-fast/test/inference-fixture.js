import { Context } from '@deepseek-ai/cordis'
import { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import * as pi from '@deepseek-ai/dsh-llm-pi-ai'

// Installed DSH adapter and Models collection; only the final provider stream is synthetic.
// No credential store, sockets, provider auth, or model requests are used.
export async function inferenceFixture(t, profile = {}) {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(LlmRuntime).await()
  const sample = ctx.plugin(pi, {
    providers: { 'openai-codex': { headers: { 'x-fixture': 'preserved' }, ...profile } },
  })
  await sample.await()
  const base = ctx.llm.adapters.get('openai-codex').adapter.config
  let profiles = base.profiles()
  await sample.dispose()
  let credential = async () => 'fixture-key-never-sent'
  const makeAdapter = () =>
    new PiAiAdapter({
      ...base,
      profiles: () => profiles,
      resolveApiKey: (...args) => credential(...args),
    })
  const adapter = makeAdapter()
  const registration = ctx.llm.registerAdapter(['openai-codex'], adapter)
  const captures = []
  function provider(snapshot = adapter.current(), behavior = {}) {
    snapshot.models.streamSimple = function (model, context, options) {
      const originalOptions = options
      return (async function* () {
        await behavior.beforePayload?.()
        options.signal?.throwIfAborted()
        const body = { model: model.id, input: context.messages, untouched: true }
        const transformed = await options.onPayload?.(body, model)
        captures.push({
          model,
          context,
          options: originalOptions,
          body: transformed ?? body,
          originalBody: body,
        })
        await behavior.afterPayload?.()
        const message = {
          role: 'assistant',
          provider: model.provider,
          model: model.id,
          api: model.api,
          content: [{ type: 'text', text: 'fixture response' }],
          usage: {
            input: 1,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 2,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'stop',
          timestamp: 1,
        }
        yield { type: 'text_delta', contentIndex: 0, delta: 'fixture response', partial: message }
        yield { type: 'done', reason: 'stop', message }
      })()
    }
    return snapshot
  }
  provider()
  return {
    ctx,
    adapter,
    registration,
    captures,
    provider,
    makeAdapter,
    credential(fn) {
      credential = fn
    },
    replaceProfiles() {
      profiles = new Map(profiles)
    },
  }
}
export const request = (sessionId = 'fast-session', extra = {}) => ({
  provider: 'openai-codex',
  model: 'gpt-6-sol',
  sessionId,
  messages: [
    {
      id: 'fixture-user',
      role: 'user',
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'synthetic input' }],
    },
  ],
  ...extra,
})
export async function consume(stream) {
  const result = []
  for await (const chunk of stream) result.push(chunk)
  return result
}
export function gate() {
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}
