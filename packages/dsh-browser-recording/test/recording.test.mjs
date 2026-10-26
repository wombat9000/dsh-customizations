import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import * as Tools from '@deepseek-ai/dsh-tools'
import * as Prompt from '@deepseek-ai/dsh-system-prompt'
import * as Recording from '../dist/src/index.js'
import { validateAction, mergeIntervals, record } from '../dist/src/runner.js'
import { buildHost } from '../scripts/build-host.mjs'
import { checkHost } from '../../../scripts/build-host.mjs'

test('strict host build and published execution-world runner stay current', () => {
  checkHost(buildHost())
})

test('recorded actions cannot become CLI options, shell commands, JavaScript or clipboard reads', async () => {
  for (const args of [
    ['eval', 'document.cookie'],
    ['click', '--cdp'],
    ['fill', '#name', '--profile'],
    ['press', '', 'Control+v'],
    ['press', '', 'F12'],
    ['move', '', '2,-1'],
    ['scroll', '', 'north'],
    ['wait', '--timeout'],
    ['fill', '#name', 'x'.repeat(2001)],
  ])
    assert.throws(() => validateAction(...args))
  for (const args of [
    ['click', '@e4'],
    ['press', '', 'Enter'],
    ['move', '', '960,150'],
    ['fill', '#name', "text'; $(not-a-shell)"],
    ['snapshot'],
  ])
    assert.doesNotThrow(() => validateAction(...args))
  await assert.rejects(
    record({ operation: 'start', id: 'not-a-uuid', url: 'https://example.com' }),
    /identity/,
  )
  for (const url of [
    'file:///etc/passwd',
    'https://user:secret@example.com',
    'javascript:alert(1)',
  ])
    await assert.rejects(
      record({ operation: 'start', id: '11111111-1111-4111-8111-111111111111', url }),
      /HTTP/,
    )
})

test('compaction scales action times into video time, merges overlaps and keeps both endpoints', () => {
  assert.deepEqual(
    mergeIntervals(
      [
        { start: 4, end: 6 },
        { start: 5, end: 10 },
        { start: 28, end: 30 },
      ],
      20,
      40,
    ),
    [
      { start: 0, end: 0.4 },
      { start: 1.75, end: 5.6 },
      { start: 13.75, end: 15.6 },
      { start: 19.65, end: 20 },
    ],
  )
  assert.deepEqual(mergeIntervals([], 0.2, 100), [{ start: 0, end: 0.2 }])
})

async function mount(t, respond) {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  ctx.provide('subprocess', {
    resolveExecutable: async () => '/execution-world/node',
    spawn(spec) {
      const request = JSON.parse(spec.argv[3])
      let output = ''
      const done = Promise.resolve().then(async () => {
        output = JSON.stringify(await respond(request, spec.signal))
        return { exitCode: 0, signal: null }
      })
      return { done, collected: { stdout: { readFrom: () => ({ text: output, lossy: false }) } } }
    },
  })
  for (const plugin of [Prompt, Tools]) await ctx.plugin(plugin.default ?? plugin, {}).await()
  const plugin = ctx.plugin(Recording)
  await plugin.await()
  const tools = ctx.get('tools')
  const call = (name, owner, args = {}, signal = new AbortController().signal) =>
    tools.get(`browser_recording_${name}`).execute(args, { agent: { session: owner }, signal })
  return { ctx, plugin, tools, call }
}

test('native registration binds recordings to owners, rejects overlaps, and releases on disposal', async (t) => {
  let releaseStart
  let starting
  const started = new Promise((resolve) => {
    starting = resolve
  })
  const active = new Set()
  const { call, plugin, tools } = await mount(t, async (request) => {
    if (request.operation === 'start') {
      active.add(request.id)
      starting()
      await new Promise((resolve) => {
        releaseStart = resolve
      })
      return { directory: '/execution-world/private', recordingId: request.id, snapshot: 'fixture' }
    }
    if (request.operation === 'discard') {
      active.delete(request.id)
      return { discarded: true }
    }
    assert.ok(active.has(request.id))
    return { output: 'own session' }
  })
  const owner = { header: { cwd: '/execution-world/workspace' } }
  const other = { header: { cwd: '/execution-world/workspace' } }
  const pending = call('start', owner, { url: 'https://example.com' })
  await started
  await assert.rejects(call('start', owner, { url: 'https://example.com' }), /already owns/)
  await assert.rejects(call('action', owner, { action: 'snapshot' }), /in progress/)
  await assert.rejects(call('action', other, { action: 'snapshot' }), /No active recording/)
  releaseStart()
  const result = await pending
  assert.equal(result.directory, undefined)
  assert.equal(result.snapshot, 'fixture')
  assert.deepEqual(await call('action', owner, { action: 'snapshot' }), { output: 'own session' })
  await plugin.dispose()
  assert.equal(active.size, 0)
  assert.equal(tools.get('browser_recording_start'), undefined)
})

test('canceling a pending action removes ownership and cleans up before another start', async (t) => {
  let canceled = false
  let actionStarted
  const started = new Promise((resolve) => {
    actionStarted = resolve
  })
  const { call } = await mount(t, async (request, signal) => {
    if (request.operation === 'start')
      return { directory: '/execution-world/private', recordingId: request.id }
    if (request.operation === 'discard') {
      canceled = true
      return { discarded: true }
    }
    signal.throwIfAborted()
    actionStarted()
    await new Promise((_, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
    )
  })
  const owner = { header: { cwd: '/execution-world/workspace' } }
  await call('start', owner, { url: 'https://example.com' })
  const controller = new AbortController()
  const action = call('action', owner, { action: 'snapshot' }, controller.signal)
  const rejected = assert.rejects(action, /cancel/)
  await started
  controller.abort(new Error('user canceled'))
  await rejected
  assert.equal(canceled, true)
  await assert.rejects(call('stop', owner), /No active recording/)
})
