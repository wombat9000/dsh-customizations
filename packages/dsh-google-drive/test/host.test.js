import assert from 'node:assert/strict'
import test from 'node:test'
import * as host from '../src/index.js'
import { createListTool, createReadTool, createRequestTool, apply } from '../src/tools.js'
import { READ_SKILL } from '../src/skill.js'

test('host declares read scope and browser routes without authenticating on mount', async () => {
  const registrations = [], cleanups = [], routes = [], events = []
  let service
  const googleAuth = {
    registerIntegration(value) { registrations.push(value); return () => registrations.pop() },
    withAccessToken() { assert.fail('install must not request tokens') },
    getAccessGeneration() { return 0 }, onAccessChange() { return () => {} },
  }
  assert.deepEqual(host.inject, ['googleAuth', 'agents', 'approval', 'webServer'])
  host.apply({ googleAuth, agents: { get() {}, roots() { return [] } }, approval: {},
    webServer: { port: 3000, register(route) { routes.push(route); return () => {} } },
    effect(fn) { cleanups.push(fn()) }, on(event) { events.push(event) },
    provide(name, value) { assert.equal(name, 'googleDrive'); service = value },
  })
  assert.deepEqual(registrations, [{ id: 'google-drive', label: 'Google Drive', scopes: ['https://www.googleapis.com/auth/drive.readonly'] }])
  assert.equal(routes.length, 6)
  assert.deepEqual(events, ['agent/disposed'])
  await assert.rejects(service.listFiles({}, {}), /exact live/)
  for (const cleanup of cleanups.reverse()) cleanup()
  assert.deepEqual(registrations, [])
})

test('tools validate input, require caller and pass exact owner plus cancellation', async () => {
  const calls = []
  const service = {
    listFiles(owner, args) { calls.push([owner, args]); return { files: [] } },
    readText(owner, args) { calls.push([owner, args]); return { text: 'hello' } },
    request(owner, args) { calls.push([owner, args]); return { state: 'denied' } },
  }
  const list = createListTool(service), read = createReadTool(service), request = createRequestTool(service)
  const exec = { agent: {}, callId: 'call', signal: new AbortController().signal }
  await assert.rejects(list.execute({}, {}), /calling agent/)
  for (const args of [{ pageSize: 101 }, { pageSize: 0 }, { pageSize: 1.2 }, { query: 'x' }, { token: 'x' }]) {
    await assert.rejects(list.execute(args, exec))
  }
  assert.equal(calls.length, 0)
  assert.deepEqual(JSON.parse(await list.execute({}, exec)), { files: [] })
  assert.equal(calls[0][0], exec.agent)
  assert.equal(calls[0][1].signal, exec.signal)
  assert.equal(calls[0][1].pageSize, 10)
  await read.execute({ fileId: 'file' }, exec)
  assert.equal(calls[1][1].maxBytes, 65536)
  await assert.rejects(read.execute({ fileId: 'file', maxBytes: 9999999 }, exec))
  await request.execute({ reason: 'Find project documents' }, exec)
  assert.equal(calls[2][1].callId, exec.callId)
  await assert.rejects(request.execute({ reason: '', selected: ['bad'] }, exec))
})

test('progressive registrations expose tool and skill only after a grant and dispose on revoke', async () => {
  let access = false, changed
  const tools = new Map(), skills = new Map(), cleanups = []
  const register = map => value => { map.set(value.name, value); return () => map.delete(value.name) }
  const scoped = { tools: { register: register(tools) }, skills: { register: register(skills) } }
  const agent = { ctx: { get: name => scoped[name], effect: fn => cleanups.push(fn()) } }
  const service = {
    assertOwner(owner) { assert.equal(owner, agent) },
    hasAccess() { return access },
    observe(owner, cb) { assert.equal(owner, agent); changed = cb; return () => { changed = undefined } },
    request() { return { state: 'denied' } },
  }
  apply({ tools: scoped.tools, skills: scoped.skills, googleDrive: service, effect: fn => cleanups.push(fn()) })
  assert.deepEqual([...tools.keys()], ['request_drive_access'])
  await tools.get('request_drive_access').execute({ reason: 'Read documents' }, { agent, callId: 'call' })
  assert.equal(skills.size, 0)
  access = true; changed()
  assert.deepEqual([...tools.keys()], ['request_drive_access', 'google_drive_list_files', 'google_drive_read_file'])
  assert.equal(skills.get('google-drive-read'), READ_SKILL)
  access = false; changed()
  assert.deepEqual([...tools.keys()], ['request_drive_access'])
  assert.equal(skills.size, 0)
  for (const cleanup of cleanups.reverse()) cleanup()
})
