import assert from 'node:assert/strict'
import test from 'node:test'
import { registerProjectWriteTools } from '../src/tools/project-writes.js'

function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function fixture(prepare) {
  const tools = new Map()
  const events = new Map()
  const disposers = []
  let executions = 0
  const writes = {
    prepareCreate:
      prepare ??
      (async () =>
        Object.freeze({
          kind: 'create-project',
          reason: 'Exact preview',
          input: Object.freeze({ name: 'Approved' }),
        })),
    async executeCreate(value, signal) {
      signal?.throwIfAborted()
      executions += 1
      return value.input
    },
  }
  registerProjectWriteTools(
    {
      tools: { register: (tool) => tools.set(tool.name, tool) },
      on: (name, callback) => events.set(name, callback),
      effect: (effect) => disposers.push(effect()),
    },
    writes,
    { timeoutMs: 30000 },
  )
  const exec = {
    name: 'linear_create_project',
    token: Symbol('call'),
    arguments: { name: 'Approved', teams: ['ENG'] },
    signal: new AbortController().signal,
    agent: { session: { id: 'session' } },
  }
  return {
    exec,
    prepare: (next = async () => ({ kind: 'allow' })) =>
      events.get('tools/pre-execute')(exec, next),
    execute: (caller = exec) => tools.get(exec.name).execute(caller.arguments, caller),
    finish: () => events.get('tools/result')(exec),
    dispose: () => disposers.forEach((dispose) => dispose()),
    executions: () => executions,
  }
}

test('another policy cannot replace the exact Linear preview', async () => {
  const f = fixture()
  const result = await f.prepare(async () => ({ kind: 'ask', reason: 'Other policy' }))
  assert.equal(result.kind, 'ask')
  assert.match(result.reason, /Exact preview/)
  assert.match(result.reason, /Other policy/)
  assert.deepEqual(await f.execute(), { name: 'Approved' })
  await assert.rejects(f.execute(), /approval was not prepared/)
})

test('denied or throwing policies leave no executable Linear preparation', async () => {
  for (const kind of ['deny', 'cancel', 'throw']) {
    const f = fixture()
    const next = async () => {
      if (kind === 'throw') throw new Error('Policy failed')
      return { kind, reason: 'Blocked' }
    }
    if (kind === 'throw') await assert.rejects(f.prepare(next), /Policy failed/)
    else assert.equal((await f.prepare(next)).kind, kind)
    await assert.rejects(f.execute(), /approval was not prepared/)
    assert.equal(f.executions(), 0)
  }
})

test('result cleanup fences preparation that finishes after the call', async () => {
  const pending = deferred()
  const f = fixture(() => pending.promise)
  const policy = f.prepare()
  f.finish()
  pending.resolve({ kind: 'create-project', reason: 'Late preview', input: {} })
  assert.equal((await policy).kind, 'deny')
  await assert.rejects(f.execute(), /approval was not prepared/)
  assert.equal(f.executions(), 0)
})

test('unloading during downstream policy or before execution revokes preparation', async () => {
  for (const duringPolicy of [false, true]) {
    const f = fixture()
    const pending = deferred()
    const entered = deferred()
    const policy = duringPolicy
      ? f.prepare(() => {
          entered.resolve()
          return pending.promise
        })
      : f.prepare()
    if (duringPolicy) await entered.promise
    else await policy
    f.dispose()
    pending.resolve({ kind: 'allow' })
    if (duringPolicy) assert.equal((await policy).kind, 'deny')
    await assert.rejects(f.execute(), /approval was not prepared/)
    assert.equal(f.executions(), 0)
  }
})

test('execution observes a deadline signal installed after preparation', async () => {
  const f = fixture()
  await f.prepare()
  const deadline = new AbortController()
  f.exec.signal = deadline.signal
  deadline.abort()
  await assert.rejects(f.execute(), { name: 'AbortError' })
  assert.equal(f.executions(), 0)
})

test('an approved preparation cannot move to another agent or session', async () => {
  for (const changeSession of [false, true]) {
    const f = fixture()
    await f.prepare()
    const caller = { ...f.exec, agent: { session: f.exec.agent.session } }
    if (changeSession) {
      caller.agent = f.exec.agent
      caller.agent.session = { id: 'other' }
    }
    await assert.rejects(f.execute(caller), /approval was not prepared/)
    assert.equal(f.executions(), 0)
  }
})
