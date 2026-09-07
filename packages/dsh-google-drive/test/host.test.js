import assert from 'node:assert/strict'
import test from 'node:test'
import * as host from '../src/index.js'
import { createListTool } from '../src/tools.js'

const scope = 'https://www.googleapis.com/auth/drive.metadata.readonly'
test('host registers only metadata permission without authentication or configuration side effects', async () => {
  const registrations = []
  const cleanups = []
  let service
  const googleAuth = {
    registerIntegration(value) { registrations.push(value); return () => registrations.pop() },
    withAccessToken() { assert.fail('install must not request tokens') },
  }
  assert.equal(host.name, 'google-drive')
  assert.deepEqual(host.inject, ['googleAuth'])
  assert.deepEqual(Object.keys(host).sort(), ['GoogleDriveService', 'apply', 'inject', 'name'])
  host.apply({ googleAuth, effect(fn) { cleanups.push(fn()) },
    provide(name, value) { assert.equal(name, 'googleDrive'); service = value } })
  assert.deepEqual(registrations, [{ id: 'google-drive', label: 'Google Drive', scopes: [scope] }])
  assert.deepEqual(Object.keys(service), ['listFiles'])
  for (const cleanup of cleanups.reverse()) cleanup()
  assert.deepEqual(registrations, [])
  await assert.rejects(service.listFiles(), /cancelled/)
})

test('every Drive call requests the shared token for its registered integration', async () => {
  const ids = []
  const requests = []
  const service = new host.GoogleDriveService({
    googleAuth: {
      getAccessToken() { assert.fail('consumer must use lifecycle wrapper') },
      withAccessToken(id, operation) { ids.push([id]); return operation(`access-${ids.length}`, new AbortController().signal) },
    },
    fetch: async (url, init) => { requests.push({ url, init }); return Response.json({ files: [] }) },
  })
  await service.listFiles()
  await service.listFiles({ pageSize: 1 })
  assert.deepEqual(ids, [['google-drive'], ['google-drive']])
  assert.deepEqual(requests.map(call => call.init.headers.Authorization), ['Bearer access-1', 'Bearer access-2'])
  for (const key of ['getAccessToken', 'begin', 'configure', 'status', 'credentials', 'disconnect', 'clearConfig']) assert.equal(service[key], undefined)
  service.dispose()
  await assert.rejects(service.listFiles(), /cancelled/)
  assert.equal(ids.length, 2)
})

test('tool keeps metadata API, validates input and forwards caller cancellation', async () => {
  const calls = []
  const tool = createListTool({ listFiles(args) { calls.push(args); return { files: [] } } })
  assert.equal(tool.name, 'google_drive_list_files')
  assert.match(tool.description, /Settings → Plugins → Google accounts/)
  assert.equal(tool.parameters.additionalProperties, false)
  const exec = { agent: {}, signal: new AbortController().signal }
  await assert.rejects(tool.execute({}, {}), /calling agent/)
  for (const args of [{ pageSize: 101 }, { pageSize: 0 }, { pageSize: 1.2 }, { query: 3 }, { token: 'test' }]) {
    await assert.rejects(tool.execute(args, exec), /pageSize/)
  }
  assert.equal(calls.length, 0)
  assert.deepEqual(JSON.parse(await tool.execute({ pageSize: 10 }, exec)), { files: [] })
  assert.equal(calls[0].signal, exec.signal)
})
