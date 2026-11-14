import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const cli = createRequire(createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json'))
const installed = (name) => import(pathToFileURL(cli.resolve(`@deepseek-ai/${name}`)).href)

/** Real rc.3 loops, scopes, inbox projections, and Sessions; no provider calls. */
export async function nativeAgents(t, { workingDirectory = false } = {}) {
  const { Context } = await import(pathToFileURL(cli.resolve('@deepseek-ai/cordis')).href)
  const { createUserMessage } = await installed('dsh-llm')
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  for (const name of [
    'session',
    'agent',
    'session-projection',
    'llm',
    'tools',
    'tool-executor-native',
    'system-prompt',
    'agent-loop',
  ]) {
    const module = await installed(`dsh-${name}`)
    await ctx.plugin(module.default ?? module, {}).await()
  }
  if (workingDirectory) {
    const { default: Fs } = await installed('dsh-fs-local')
    await ctx.plugin(Fs, {}).await()
    const { default: Directory } = await installed('dsh-working-directory')
    await ctx.plugin(Directory, {}).await()
  }
  const { default: Loader } = await installed('cordis-plugin-loader')
  await ctx.plugin(Loader, {}).await()
  const { default: Group } = await installed('cordis-plugin-group')
  ctx.get('loader').builtins.group = Group
  const { default: Registry } = await installed('dsh-agent-preset-registry')
  await ctx.plugin(Registry, { default: 'standard' }).await()
  const presets = ctx.get('agentPresets')
  // Empty compositions isolate native selection/projection semantics. The
  // actual Standard and Dispatch worker tools stay owned by preset.test.js.
  for (const id of ['standard', 'dispatch', 'dispatch-worker']) {
    const unregister = await presets.register({ id, plugins: [] })
    ctx.effect(() => unregister)
  }
  const errors = []
  ctx.on('agent/error', ({ error }) => errors.push(String(error)))
  t.after(() => assert.deepEqual(errors, [], 'native fixture turns must not fail before pre-step'))
  const nextSteps = new Map()
  const human = (text) =>
    createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
  const create = async (id, meta) => {
    const { agent } = await ctx.get('agentLoop').createAgent(ctx, {
      sessionId: id,
      agentOptions: { provider: 'fixture', model: 'm1' },
      meta,
    })
    // Exercise the native turn boundary without inference. In particular, a
    // prompt can start AND complete a native turn while Git inspection awaits.
    agent.ctx.on('agent/pre-step', async (event) => {
      const job = nextSteps.get(id)
      nextSteps.delete(id)
      if (job) await job(event)
      return { kind: 'enter', messages: [] }
    })
    return agent
  }
  const holdTurn = async (agent) => {
    const entered = Promise.withResolvers()
    const release = Promise.withResolvers()
    nextSteps.set(agent.id, async ({ signal }) => {
      entered.resolve(signal)
      await new Promise((done) => {
        release.promise.then(done)
        if (signal.aborted) done()
        else signal.addEventListener('abort', done, { once: true })
      })
    })
    agent.followup(human('held native turn'))
    const signal = await entered.promise
    assert.equal(agent.status, 'running')
    return {
      signal,
      async release() {
        release.resolve()
        await agent.whenIdle()
      },
    }
  }
  return {
    create,
    human,
    holdTurn,
    nextSteps,
    presetRegistry: presets,
    directoryService: ctx.get('workingDirectory'),
  }
}
