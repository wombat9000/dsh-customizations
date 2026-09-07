import test from 'node:test'
import assert from 'node:assert/strict'
import { SessionDriveTools } from '../src/session-tools.js'

function fixture(t, failAt = Infinity) {
  const registered = new Set(), effects = new Set(), observers = new Set(), calls = []
  let count = 0, manager, granted = false
  const agent = { session: { id: 'root' }, ctx: {
    get: () => ({ register(value) { if (++count === failAt) throw new Error('Registration failed'); registered.add(value); return () => registered.delete(value) } }),
    effect(fn) { const dispose = fn(); effects.add(dispose); return () => { effects.delete(dispose); dispose() } },
  } }
  const service = {
    assertOwner(owner) { assert.equal(owner, agent) },
    hasAccess: () => granted, hasEditAccess: () => false,
    observe(owner, cb) { observers.add(cb); return () => observers.delete(cb) },
    revokeSession() { calls.push('revoke'); granted = false; for (const cb of observers) cb() },
    release(owner) { manager.release(owner) },
    async request(owner, args) { calls.push(args); return { state: 'pending' } },
  }
  manager = new SessionDriveTools({ service, agents: { get: id => id === 'root' ? agent : undefined, roots: () => [agent] } })
  t.after(() => manager.dispose())
  const set = enabled => manager.set({ sessionId: 'root', ...manager.status({ sessionId: 'root' }), enabled })
  return { manager, agent, registered, observers, calls, set, grant() { granted = true; for (const cb of observers) cb() } }
}

for (const failAt of [1, 2, 3, 5]) test(`registration failure ${failAt} fails closed and cleans partial groups`, t => {
  const f = fixture(t, failAt)
  if (failAt <= 2) assert.throws(() => f.set(true), /Registration failed/)
  else { f.set(true); assert.throws(() => f.grant(), /Registration failed/) }
  assert.equal(f.manager.status({ sessionId: 'root' }).enabled, false)
  assert.equal(f.registered.size, 0)
  assert.equal(f.observers.size, 0)
  assert.ok(f.calls.includes('revoke'))
})

test('executors combine caller cancellation with the enable lifetime', async t => {
  const f = fixture(t)
  f.set(true)
  const tool = [...f.registered].find(tool => tool.name === 'request_drive_access')
  const caller = new AbortController()
  await tool.execute({ reason: 'Read notes' }, { agent: f.agent, callId: 'one', signal: caller.signal })
  const first = f.calls.at(-1).signal
  assert.equal(first.aborted, false)
  caller.abort(); assert.equal(first.aborted, true)
  await tool.execute({ reason: 'Read notes' }, { agent: f.agent, callId: 'two' })
  const second = f.calls.at(-1).signal
  f.set(false); assert.equal(second.aborted, true)
  f.set(true)
  assert.throws(() => tool.execute({}, { agent: f.agent }), /disabled/)
})

test('aborted toggle does not register or advance the revision', t => {
  const f = fixture(t), initial = f.manager.status({ sessionId: 'root' }), abort = new AbortController()
  abort.abort()
  assert.throws(() => f.manager.set({ sessionId: 'root', ...initial, enabled: true }, abort.signal))
  assert.deepEqual(f.manager.status({ sessionId: 'root' }), initial)
  assert.equal(f.registered.size, 0)
})
