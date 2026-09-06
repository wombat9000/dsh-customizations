import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import LlmRuntime, { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'

const require = createRequire(import.meta.url)
const cli = createRequire(require.resolve('@deepseek-ai/dsh/package.json'))
const installed = name => import(pathToFileURL(cli.resolve(name)).href)
const ToolJobs = await installed('@deepseek-ai/dsh-tool-jobs')
const { default: yaml } = await installed('js-yaml')
const { entryListSchema } = await installed('@deepseek-ai/cordis-plugin-include')
const rows = yaml.load(await readFile(new URL('../presets/worktree-coordinator/agent.cordis.yml', import.meta.url), 'utf8'), { schema: entryListSchema })
const config = rows.find(row => row.id === 'tool-jobs').config
const deferred = () => Promise.withResolvers()
const message = (kind, text) => createUserMessage({ content: [{ type: 'text', text }], source: kind === 'user' ? { kind } : { kind, plugin: 'fixture' } })

// Real upstream controller, job registry, inbox and agent loop. Only model text
// is fake. Gates control completion ordering without timers or paid requests.
async function fixture(t) {
  const ctx = new Context()
  const gates = []
  t.after(async () => {
    for (const gate of gates) gate.release.resolve()
    await ctx.fiber.dispose()
  })
  for (const Plugin of [SessionStore, AgentRegistry, SessionProjections, SystemPrompt, Tools, LlmRuntime, LocalJobRegistry]) {
    await ctx.plugin(Plugin, {}).await()
  }
  const requests = []
  let gate
  class FakeModel extends LlmAdapter {
    async *stream(options) {
      requests.push(options)
      const current = gate
      gate = undefined
      if (current) { current.entered.resolve(); await current.release.promise }
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'Progress update.' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Progress update.' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.get('llm').registerAdapter(['fixture'], new FakeModel())
  await ctx.plugin(AgentLoop, {}).await()
  const { agent } = await ctx.get('agents').create({
    sessionId: SessionId('coordinator'),
    agentOptions: { provider: 'fixture', model: 'test-model', maxTokens: 1024 },
  })
  // Mount in the actual owner's scope, as a preset consumer does.
  await agent.ctx.plugin(ToolJobs, config).await()
  const followup = t.mock.method(agent, 'followup')
  const inject = t.mock.method(agent, 'inject')
  const claimed = []
  ctx.on('agent/inbox/claimed', event => { if (event.agent === agent) claimed.push(event.message) })
  const jobs = ctx.get('jobs')
  async function complete() {
    const done = deferred()
    const noticed = deferred()
    const id = jobs.start({ owner: agent, kind: 'worktree', label: 'fixture worker', run: () => ({
      done: done.promise, cancel() { done.resolve({ status: 'killed' }) },
    }) })
    const off = agent.ctx.get('jobs').onJobDone(snapshot => { if (snapshot.id === id) noticed.resolve() })
    done.resolve({ status: 'completed', output: 'Worker report' })
    await noticed.promise
    off()
    return id
  }
  return { agent, jobs, requests, claimed, followup, inject, complete,
    hold() {
      gate = { entered: deferred(), release: deferred() }
      const current = gate
      gates.push(current)
      return current
    },
  }
}

const noticeText = msg => msg.content.map(block => block.text ?? '').join('\n')

test('idle completion opens one real followup and retains its report', { timeout: 10000 }, async t => {
  const f = await fixture(t)
  assert.equal(f.agent.status, 'idle')
  const id = await f.complete()
  await f.agent.whenIdle()
  assert.equal(f.followup.mock.callCount(), 1)
  assert.equal(f.inject.mock.callCount(), 0)
  assert.equal(f.requests.length, 1)
  assert.equal(f.claimed.length, 1)
  assert.match(noticeText(f.claimed[0]), new RegExp(id))
  assert.equal(f.jobs.read(id, f.agent).text, 'Worker report')
  assert.equal(f.agent.status, 'idle')
})

test('busy completion injects without scheduling a duplicate followup', { timeout: 10000 }, async t => {
  const f = await fixture(t)
  const gate = f.hold()
  f.agent.followup(message('user', 'Start independent work'))
  await gate.entered.promise
  assert.equal(f.agent.status, 'running')
  const id = await f.complete()
  assert.equal(f.followup.mock.callCount(), 1, 'only the human turn opens a followup')
  assert.equal(f.inject.mock.callCount(), 1)
  assert.match(noticeText(f.inject.mock.calls[0].arguments[0]), new RegExp(id))
  gate.release.resolve()
  await f.agent.whenIdle()
  assert.equal(f.followup.mock.callCount(), 1)
  assert.equal(f.claimed.filter(msg => noticeText(msg).includes(id)).length, 1)
  assert.equal(f.agent.session.snapshotEvents().filter(event => event.type === 'turn/start').length, 1)
})

test('ten idle wakes exhaust the budget and later completions stay queued', { timeout: 10000 }, async t => {
  const f = await fixture(t)
  for (let i = 0; i < 10; i++) { await f.complete(); await f.agent.whenIdle() }
  assert.equal(f.followup.mock.callCount(), 10)
  assert.equal(f.requests.length, 10)
  const id = await f.complete()
  await f.agent.whenIdle()
  assert.equal(f.followup.mock.callCount(), 10)
  assert.equal(f.inject.mock.callCount(), 1)
  assert.equal(f.requests.length, 10)
  assert.equal(f.claimed.length, 10, 'exhausted notice has not been claimed')
  assert.equal(f.jobs.get(id, f.agent).status, 'completed')
  assert.equal(f.agent.status, 'idle')
})

test('only a claimed human message resets the exhausted wake budget', { timeout: 10000 }, async t => {
  const f = await fixture(t)
  for (let i = 0; i < 10; i++) { await f.complete(); await f.agent.whenIdle() }
  f.agent.followup(message('plugin', 'Plugin continuation'))
  await f.agent.whenIdle()
  const queued = await f.complete()
  assert.equal(f.followup.mock.callCount(), 11, 'plugin claim does not reset budget')
  f.agent.inject(message('user', 'Continue coordination'))
  await f.complete()
  assert.equal(f.followup.mock.callCount(), 11, 'insertion alone does not reset budget')
  f.agent.followup(message('plugin', 'Claim pending inbox'))
  await f.agent.whenIdle()
  assert.ok(f.claimed.some(msg => noticeText(msg).includes(queued)), 'queued completion survives until the next turn')
  assert.ok(f.claimed.some(msg => msg.source.kind === 'user' && noticeText(msg) === 'Continue coordination'))
  const before = f.followup.mock.callCount()
  for (let i = 0; i < 10; i++) { await f.complete(); await f.agent.whenIdle() }
  assert.equal(f.followup.mock.callCount(), before + 10, 'human claim restores all ten wakes')
  await f.complete()
  assert.equal(f.followup.mock.callCount(), before + 10, 'reset remains bounded')
})
