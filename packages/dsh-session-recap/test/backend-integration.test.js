import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { backend, model, state, userMessage, version } from './fixtures/backend.js'
import { CHANNEL, name } from '../src/index.js'

const route = { provider: 'fixture', model: 'summary' }
const success = (result) => {
  assert.equal(result.ok, true, JSON.stringify(result))
  return result.value
}
const failure = (result, code) => {
  assert.equal(result.ok, false)
  assert.equal(result.error.code, code)
}

test(
  'real backend RPC owns registration, calls, settings persistence, disposal and remount',
  { timeout: 15000 },
  async (t) => {
    assert.equal(version, '0.1.5-rc.2')
    const directory = await state(t)
    const host = await backend(t, directory)
    assert.equal(host.routes.size, 1)
    assert.equal((await host.request('settings', {}, { host: 'untrusted.invalid' })).status, 403)
    assert.equal((await host.request('settings', {}, { authorization: 'wrong' })).status, 401)
    const initial = success(await host.rpc('settings'))
    assert.equal(initial.provider, '')
    assert.equal(initial.inactivityMinutes, 30)
    assert.equal(success(await host.rpc('models')).providers[0].id, 'fixture')
    failure(await host.rpc('unknown'), 'unknown-endpoint')
    const saved = success(
      await host.rpc('configure', { ...route, inactivityMinutes: 91, autoRecap: false }),
    )
    const disk = await readFile(join(directory, 'settings.json'), 'utf8')
    assert.equal(JSON.parse(disk)[name].inactivityMinutes, 91)
    assert.equal(host.ctx.settings.get(name).model, route.model)
    for (const [payload, code] of [
      [{ inactivityMinutes: 0 }, 'invalid-settings'],
      [{ extra: true }, 'invalid-settings'],
      [{ model: '' }, 'invalid-settings'],
      [{ model: 'image-only' }, 'invalid-model'],
    ]) {
      failure(await host.rpc('configure', payload), code)
      assert.equal(await readFile(join(directory, 'settings.json'), 'utf8'), disk)
      assert.deepEqual(success(await host.rpc('settings')), saved)
    }
    // Also exercise the actual settings schema, not just recap's input validator.
    await assert.rejects(host.ctx.settings.update(name, { inactivityMinutes: 0 }))
    assert.equal(await readFile(join(directory, 'settings.json'), 'utf8'), disk)
    assert.deepEqual(success(await host.rpc('settings')), saved)
    await host.unmount()
    assert.equal(host.routes.has(CHANNEL), false)
    assert.equal(host.ctx.settings.get(name), undefined)
    assert.equal((await host.request('settings')).status, 404)
    await host.unmount()
    await host.mount()
    assert.equal(host.routes.size, 1)
    assert.deepEqual(success(await host.rpc('settings')), saved)
    await host.close()
    const fresh = await backend(t, directory)
    assert.notEqual(fresh.ctx, host.ctx)
    assert.deepEqual(success(await fresh.rpc('settings')), saved)
    assert.equal(
      fresh.llm.calls.length,
      0,
      'saving and restoring settings makes no generation call',
    )
  },
)

test(
  'real persisted session history restores, recaps, rejects running turns and invalidates cache',
  { timeout: 15000 },
  async (t) => {
    const directory = await state(t)
    const first = await backend(t, directory)
    success(await first.rpc('configure', route))
    const original = await first.createSession()
    userMessage(original)
    original.append('turn/start', { turn: 0 })
    original.append('turn/end', { turn: 0, reason: { kind: 'stop' } })
    const originalEvents = original.snapshotEvents()
    await first.ctx.sessionPersistence.flush()
    const artifact = first.ctx.sessionPersistence.locate(original.header).path
    assert.match(await readFile(artifact, 'utf8'), /offline integration test/)
    await first.close()

    const host = await backend(t, directory)
    const session = await host.restoreSession()
    assert.notEqual(session, original)
    assert.deepEqual(session.snapshotEvents(0, originalEvents.length), originalEvents)
    assert.equal(session.deriveMessages()[0].content[0].text, 'Plan an offline integration test.')
    assert.deepEqual(success(await host.rpc('activity', { sessionId: session.id })), {
      ready: true,
      running: false,
      latestActivity: originalEvents.at(-1).time,
    })
    const generated = success(await host.rpc('recap', { sessionId: session.id }))
    assert.equal(generated.revision, session.seq)
    assert.equal(generated.cached, false)
    assert.match(host.llm.calls[0].messages[0].content[0].text, /offline integration test/)
    assert.equal(success(await host.rpc('recap', { sessionId: session.id })).cached, true)
    assert.equal(host.llm.calls.length, 1)
    session.append('turn/start', { turn: 1 })
    failure(await host.rpc('recap', { sessionId: session.id }), 'session-running')
    assert.equal(host.llm.calls.length, 1)
    assert.equal(success(await host.rpc('activity', { sessionId: session.id })).running, true)
    session.append('turn/end', { turn: 1, reason: { kind: 'stop' } })
    assert.equal(success(await host.rpc('recap', { sessionId: session.id })).cached, false)
    assert.equal(host.llm.calls.length, 2)
    await host.ctx.sessionPersistence.flush()
  },
)

test(
  'real session and settings changes invalidate pending recaps; disposal aborts and remount recovers',
  { timeout: 15000 },
  async (t) => {
    const directory = await state(t)
    const llm = model()
    const host = await backend(t, directory, llm)
    success(await host.rpc('configure', route))
    const session = await host.createSession()
    userMessage(session)
    for (const change of [
      async () => {
        userMessage(session, 'The plan changed.')
        await host.ctx.sessionPersistence.flush()
      },
      async () => {
        success(await host.rpc('configure', { inactivityMinutes: 92 }))
      },
    ]) {
      const pending = llm.hold()
      const response = host.rpc('recap', { sessionId: session.id })
      await pending.entered.promise
      await change()
      pending.release.resolve()
      failure(await response, 'stale')
    }
    const pending = llm.hold()
    const response = host.rpc('recap', { sessionId: session.id })
    const request = await pending.entered.promise
    assert.equal(request.signal.aborted, false)
    await host.unmount()
    assert.equal(request.signal.aborted, true)
    failure(await response, 'cancelled')
    assert.equal(host.routes.size, 0)
    assert.equal(host.ctx.settings.get(name), undefined)
    await host.mount()
    assert.equal(success(await host.rpc('recap', { sessionId: session.id })).cached, false)
    assert.equal(host.routes.size, 1)
  },
)
