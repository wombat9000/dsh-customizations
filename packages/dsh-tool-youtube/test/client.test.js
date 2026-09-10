import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import test from 'node:test'

const CLIENT_PATH = fileURLToPath(new URL('../client.js', import.meta.url))
const PACKAGE_PATH = fileURLToPath(new URL('../package.json', import.meta.url))

async function loadClient(react = {}) {
  let record
  const browserWindow = {
    confirm: () => true,
    __ModuleLoader__: {
      load(value) { record = value },
    },
  }
  const source = await readFile(CLIENT_PATH, 'utf8')
  vm.runInNewContext(source, { window: browserWindow })
  assert.ok(record)
  return {
    browserWindow,
    record,
    exports: record.factory((specifier) => {
      assert.equal(specifier, 'react')
      return react
    }),
  }
}

function fakeReact(stateValues, runEffects = false) {
  let stateIndex = 0
  const updates = []
  const cleanups = []
  return {
    updates,
    cleanups,
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children: children.flat(Infinity) }
    },
    useState(initial) {
      const index = stateIndex++
      updates[index] = []
      return [index < stateValues.length ? stateValues[index] : initial, (value) => updates[index].push(value)]
    },
    useEffect(effect) {
      if (!runEffects) return
      const cleanup = effect()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    },
  }
}

function findElements(root, predicate, found = []) {
  if (root === null || root === undefined || typeof root !== 'object') return found
  if (predicate(root)) found.push(root)
  for (const child of root.children ?? []) findElements(child, predicate, found)
  return found
}

function textOf(root) {
  if (typeof root === 'string') return root
  if (root === null || root === undefined || typeof root !== 'object') return ''
  return (root.children ?? []).map(textOf).join('')
}

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

test('package exposes the Web Settings client bundle', async () => {
  const pkg = JSON.parse(await readFile(PACKAGE_PATH, 'utf8'))
  assert.equal(pkg.exports['./client'], './client.js')
  assert.ok(pkg.files.includes('client.js'))
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.deepEqual(pkg.dsh.client.inject, [
    '@deepseek-ai/dsh-client-ui-settings',
    '@deepseek-ai/dsh-api-remotes',
  ])
})

test('client bundle registers the expected module and Settings section', async () => {
  const { record, exports } = await loadClient()
  assert.equal(record.id, '@local/dsh-tool-youtube')
  assert.deepEqual(Array.from(exports.inject), ['slots', 'connection', 'remote'])
  assert.equal(exports.CREDENTIAL_REF, 'GEMINI_API_KEY')

  const registrations = []
  const rpc = { call: async () => ({ ok: true, value: null }) }
  const context = {
    remote: { $on: () => () => {} },
    get(service) {
      assert.equal(service, 'connection')
      return { api: { credentials: {} }, rpc }
    },
    on: () => () => {},
    slots: {
      inject(name, callback) {
        assert.ok(['settings.section', 'tool.call.toolview'].includes(name))
        callback()
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
  }

  exports.apply(context)
  const settings = registrations.find((entry) => entry.options.name === 'settings.section')
  assert.equal(settings.options.id, 'youtube')
  assert.equal(settings.options.order, 30)
  assert.equal(settings.options.label, 'YouTube')
  assert.equal(typeof settings.options.inject, 'function')
  assert.equal(typeof settings.component, 'function')
  const toolviews = registrations.filter((entry) => entry.options.name === 'tool.call.toolview')
  assert.deepEqual(toolviews.map((entry) => entry.options.key), [
    'youtube_watch',
    'youtube_transcript',
    'youtube_transcript_read',
    'youtube_transcript_search',
  ])
  assert.ok(toolviews.every((entry) => entry.options.locale === 'conversation'))
  assert.ok(toolviews.every((entry) => entry.options.inject().rpc === rpc))
  assert.ok(toolviews.every((entry) => entry.component === exports.YoutubeToolCard))
})

test('Settings subscription filters credential events and disposes listeners', async () => {
  const { exports } = await loadClient()
  const handlers = {}
  const disposed = []
  const registrations = []
  const context = {
    remote: {
      $on(name, handler) {
        handlers[name] = handler
        return () => disposed.push(name)
      },
    },
    get: () => ({ api: { credentials: {} }, rpc: {} }),
    on(name, handler) {
      handlers[name] = handler
      return () => disposed.push(name)
    },
    slots: {
      inject: (_name, callback) => callback(),
      register(options) {
        registrations.push(options)
        return () => {}
      },
    },
  }
  exports.apply(context)
  const props = registrations.find((entry) => entry.name === 'settings.section').inject()
  let refreshes = 0
  const dispose = props.subscribe(() => { refreshes += 1 })

  handlers['credentials/reference-updated']('OTHER_KEY')
  assert.equal(refreshes, 0)
  handlers['credentials/reference-updated']('GEMINI_API_KEY')
  handlers['connection/reset']()
  assert.equal(refreshes, 2)
  dispose()
  assert.deepEqual(disposed.sort(), ['connection/reset', 'credentials/reference-updated'])
})

test('Gemini card describes only status and disables read-only credentials', async () => {
  const react = fakeReact([
    { configured: true, writable: false, source: 'env' },
    '',
    false,
    undefined,
    undefined,
    0,
  ])
  const { exports } = await loadClient(react)
  const tree = exports.GeminiSettingsSection({
    api: { credentials: {} },
    subscribe: () => () => {},
  })
  const [input] = findElements(tree, (element) => element.type === 'input')
  const buttons = findElements(tree, (element) => element.type === 'button')

  assert.equal(input.props.type, 'password')
  assert.equal(input.props.disabled, true)
  assert.equal(buttons.length, 1)
  assert.equal(buttons[0].props.disabled, true)
  assert.match(textOf(tree), /Configured via launch environment/)
  assert.match(textOf(tree), /read-only source/)
})

test('Gemini card uses status-only describe and does not retain returned secrets', async () => {
  const react = fakeReact([], true)
  let describeRequest
  const { exports } = await loadClient(react)
  exports.GeminiSettingsSection({
    api: {
      credentials: {
        async describe(request) {
          describeRequest = request
          return {
            result: {
              ok: true,
              value: {
                credentials: {
                  GEMINI_API_KEY: { configured: true, writable: true, source: 'file' },
                },
              },
            },
          }
        },
      },
    },
    subscribe: () => () => {},
  })
  await Promise.resolve()
  await Promise.resolve()

  assert.deepEqual(plain(describeRequest), { refs: ['GEMINI_API_KEY'] })
  const credentialUpdate = react.updates[0].find((value) => typeof value === 'object' && value !== null)
  assert.deepEqual(plain(credentialUpdate), { configured: true, writable: true, source: 'file' })
  assert.equal(Object.hasOwn(credentialUpdate, 'value'), false)
})

test('Gemini card sends write-only set and unset requests and clears the draft', async () => {
  const react = fakeReact([
    { configured: true, writable: true, source: 'file' },
    '  AIza-secret-value  ',
    false,
    undefined,
    undefined,
    0,
  ])
  const calls = []
  const { exports } = await loadClient(react)
  const tree = exports.GeminiSettingsSection({
    api: {
      credentials: {
        async describe() { throw new Error('effect should not run') },
        async set(request) {
          calls.push(['set', request])
          return { result: { ok: true, value: { configured: true } } }
        },
        async unset(request) {
          calls.push(['unset', request])
          return { result: { ok: true, value: { configured: false } } }
        },
      },
    },
    subscribe: () => () => {},
  })
  const buttons = findElements(tree, (element) => element.type === 'button')
  assert.deepEqual(buttons.map(textOf), ['Replace key', 'Remove key'])

  buttons[0].props.onClick()
  await Promise.resolve()
  await Promise.resolve()
  buttons[1].props.onClick()
  await Promise.resolve()
  await Promise.resolve()

  assert.deepEqual(plain(calls), [
    ['set', { ref: 'GEMINI_API_KEY', value: 'AIza-secret-value' }],
    ['unset', { ref: 'GEMINI_API_KEY' }],
  ])
  assert.ok(react.updates[1].includes(''))
  assert.equal(JSON.stringify(react.updates).includes('AIza-secret-value'), false)
})

test('shared card renders honest accessible transcript progress', async () => {
  const progress = {
    phase: 'transcribing', durationSeconds: 7_200, totalChunks: 3, completedChunks: 1,
    chunks: [
      { id: '1', index: 0, startSeconds: 0, endSeconds: 900, status: 'complete' },
      { id: '2', index: 1, startSeconds: 900, endSeconds: 3_600, status: 'fallback' },
      { id: '3', index: 2, startSeconds: 3_600, endSeconds: 7_200, status: 'pending' },
    ],
  }
  const react = fakeReact([true, progress, 0])
  const { exports } = await loadClient(react)
  const tree = exports.YoutubeToolCard({
    toolName: 'youtube_transcript', callId: 'call-live',
    block: { name: 'youtube_transcript', argsRaw: JSON.stringify({ url: 'https://youtu.be/dQw4w9WgXcQ' }) },
    rpc: {},
  })
  assert.match(textOf(tree), /Recovering 1\/3/)
  const [bar] = findElements(tree, (element) => element.props?.['aria-label'] === 'Transcript progress')
  assert.equal(bar.props['aria-valuenow'], 13)
  const intervals = findElements(tree, (element) => element.props?.['data-chunk-status'] !== undefined)
  assert.deepEqual(intervals.map((element) => element.props['data-chunk-status']), ['complete', 'fallback', 'pending'])
  assert.ok(intervals.every((element) => element.props.tabIndex === undefined && element.props['aria-hidden'] === undefined))
})

test('shared card uses disclosure and indeterminate or degraded progress honestly', async () => {
  const block = { name: 'youtube_transcript', argsRaw: '{}' }
  const collapsedReact = fakeReact([false, undefined, 0])
  const collapsed = (await loadClient(collapsedReact)).exports.YoutubeToolCard({ toolName: 'youtube_transcript', block, callId: 'call', rpc: {} })
  const [disclosure] = findElements(collapsed, (element) => element.type === 'button')
  assert.equal(disclosure.props['aria-expanded'], false)
  assert.equal(findElements(collapsed, (element) => element.props?.role === 'progressbar')[0].props['aria-valuenow'], undefined)

  const degradedReact = fakeReact([true, undefined, 6])
  const degraded = (await loadClient(degradedReact)).exports.YoutubeToolCard({ toolName: 'youtube_transcript', block, callId: 'call', rpc: {} })
  assert.match(textOf(degraded), /Live progress is unavailable/)
})

test('transcript card polls the existing progress RPC and leads with final outcome', async () => {
  const react = fakeReact([], true)
  const calls = []
  const { exports } = await loadClient(react)
  exports.YoutubeToolCard({
    toolName: 'youtube_transcript', callId: 'call-poll',
    block: { name: 'youtube_transcript', argsRaw: '{}' },
    rpc: { async call(channel, endpoint, payload) {
      calls.push([channel, endpoint, payload])
      return { ok: true, value: { phase: 'complete', totalChunks: 1, completedChunks: 1 } }
    } },
  })
  await Promise.resolve()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(plain(calls), [['/youtube-transcript-progress', 'get', { callId: 'call-poll' }]])
  assert.deepEqual(plain(react.updates[1][0]), { phase: 'complete', totalChunks: 1, completedChunks: 1 })

  const finalReact = fakeReact([true, undefined, 0])
  const final = (await loadClient(finalReact)).exports.YoutubeToolCard({
    toolName: 'youtube_transcript', callId: 'done', rpc: {},
    block: {
      kind: 'tool-result', isError: false,
      call: { name: 'youtube_transcript', argsRaw: JSON.stringify({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }) },
      meta: { phase: 'complete', durationSeconds: 3_600, truncated: true, result: { totalSegments: 842, nextCursor: 240 } },
      content: [{ type: 'text', text: 'Language: English\nDuration: 1:00:00\n\n[0:00] Host: Hello\n\n(Inline transcript truncated at a segment boundary. Continue with youtube_transcript_read using cursor 240.)' }],
    },
  })
  assert.match(textOf(final), /Transcript ready · 1:00:00 · 842 segments/)
  assert.match(textOf(final), /more segments are safely archived · continue at cursor 240/)
})

test('shared card exposes useful errors without fake progress', async () => {
  const react = fakeReact([true, undefined, 0])
  const { exports } = await loadClient(react)
  const tree = exports.YoutubeToolCard({
    toolName: 'youtube_transcript', callId: 'failed', rpc: {}, inspect: () => {},
    block: {
      kind: 'tool-result', isError: true,
      call: { name: 'youtube_transcript', argsRaw: JSON.stringify({ url: 'https://youtu.be/dQw4w9WgXcQ' }) },
      content: [{ type: 'text', text: 'Gemini rate limit or quota exceeded' }],
    },
  })
  assert.match(textOf(tree), /Gemini rate limit or quota exceeded/)
  assert.match(textOf(tree), /View error details/)
  assert.equal(findElements(tree, (element) => element.props?.role === 'progressbar').length, 0)
  assert.equal(findElements(tree, (element) => element.props?.role === 'alert').length, 1)
})

test('watch, read, and search cards render outcome summaries and timestamp links', async () => {
  const cases = [
    {
      toolName: 'youtube_watch',
      args: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', question: 'What happens?' },
      text: 'The presenter saves the file.\n\nEvidence:\n- [0:42] (visual) The Save button changes.\n\nCaveats:\n- Rapid events may be missed.',
      expected: /Answer ready · 1 evidence item/,
    },
    {
      toolName: 'youtube_transcript_read', args: { transcriptId: 'tr-1', cursor: 20 },
      text: '[1:00] Host: First\n[1:05] Guest: Second\n\n(More archived segments are available at cursor 22.)',
      expected: /2 transcript segments · more available/,
    },
    {
      toolName: 'youtube_transcript_search', args: { transcriptId: 'tr-1', query: 'quota' },
      text: '[2:10] Host: The quota is bounded.', expected: /1 match for “quota”/,
    },
  ]
  for (const item of cases) {
    const react = fakeReact([true, undefined, 0])
    const { exports } = await loadClient(react)
    const tree = exports.YoutubeToolCard({
      toolName: item.toolName, callId: item.toolName, rpc: {},
      block: { kind: 'tool-result', isError: false, call: { name: item.toolName, argsRaw: JSON.stringify(item.args) }, content: [{ type: 'text', text: item.text }] },
    })
    assert.match(textOf(tree), item.expected)
    if (item.toolName === 'youtube_watch') {
      const [link] = findElements(tree, (element) => element.type === 'a' && element.children?.includes('0:42'))
      assert.equal(link.props.href, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s')
      assert.equal(link.props.rel, 'noopener noreferrer')
    }
  }
})

test('client-side key validation rejects blank and shell-style pastes', async () => {
  const { exports } = await loadClient()

  assert.equal(exports.apiKeyFailure('AIza-valid-key'), undefined)
  assert.match(exports.apiKeyFailure('   '), /Enter a Gemini API key/)
  assert.match(exports.apiKeyFailure('GEMINI_API_KEY=AIza-key'), /Paste only the API key/)
  assert.match(exports.apiKeyFailure('"AIza-key"'), /Paste only the API key/)
  assert.match(exports.apiKeyFailure('AIza-\nkey'), /printable characters only/)
})
