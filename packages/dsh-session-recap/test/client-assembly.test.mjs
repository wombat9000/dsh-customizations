import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildClient, clientPath } from '../scripts/build-client.mjs'
import { CARD_LABELS, CARD_TITLES } from '../src/cards.js'

const source = readFileSync(clientPath, 'utf8')

function loadBundle() {
  const registrations = []
  const window = { __ModuleLoader__: { load: (registration) => registrations.push(registration) } }
  // No require, module, exports, process, or React globals exist at script load.
  vm.runInNewContext(source, { window, setTimeout, clearTimeout })
  assert.equal(registrations.length, 1)
  const [{ id, factory }] = registrations
  assert.equal(id, '@wombat9000/dsh-session-recap')
  const requested = []
  const plugin = factory((name) => {
    requested.push(name)
    assert.equal(name, 'react', 'all client externals must be supplied by DSH')
    return {}
  })
  return { plugin, requested }
}

test('committed client entry matches reproducible tsdown output', async () => {
  const first = await buildClient()
  assert.equal(first, await buildClient())
  assert.equal(source, first, 'Run node packages/dsh-session-recap/scripts/build-client.mjs')
})

test('built client registers one lazy factory with the existing plugin surface', () => {
  const { plugin, requested } = loadBundle()
  assert.deepEqual([...new Set(requested)], ['react'])
  assert.deepEqual(
    Object.keys(plugin).sort(),
    [
      'inject',
      'apply',
      'createController',
      'RecapCard',
      'RecapAction',
      'SettingsCard',
      'CARD_LABELS',
      'CHANNEL',
    ].sort(),
  )
  assert.deepEqual(Array.from(plugin.inject), ['slots', 'connection', 'remote'])
  assert.equal(plugin.CHANNEL, '/session-recap')
  assert.deepEqual(Object.keys(plugin.CARD_LABELS), CARD_LABELS)
  for (const label of CARD_LABELS) {
    assert.equal(plugin.CARD_LABELS[label].title, CARD_TITLES[label])
  }
})

test('built plugin registers existing slots with one shared controller', () => {
  const { plugin } = loadBundle()
  const entries = []
  const events = new Map()
  plugin.apply({
    get: (name) =>
      name === 'remote' ? { $on: (event, handler) => events.set(event, handler) } : { rpc: {} },
    slots: {
      inject: (_name, register) => register(),
      register: (entry, component) => entries.push({ entry, component }),
    },
  })
  assert.deepEqual(
    entries.map(({ entry }) => entry.name),
    ['conversation.input.dock', 'conversation.chat.assistant-actions', 'settings.plugin.item'],
  )
  assert.equal(entries[2].entry.key, 'wombat9000-session-recap')
  const dock = entries[0].entry.inject('session-1')
  const action = entries[1].entry.inject('session-1')
  assert.equal(dock.sessionId, 'session-1')
  assert.equal(action.sessionId, 'session-1')
  assert.equal(action.controller, dock.controller)
  assert.equal(entries[2].entry.inject().controller, dock.controller)
  assert.equal(entries[0].component, plugin.RecapCard)
  assert.equal(entries[1].component, plugin.RecapAction)
  assert.equal(events.size, 1)
  let sent
  dock.controller.humanMessageSent = (id) => {
    sent = id
  }
  events.get('api-session/activity')('session-1', 123)
  assert.equal(sent, 'session-1')
  assert.doesNotMatch(
    source,
    /setInterval|dangerouslySetInnerHTML|conversation\.submit|session\.append/,
  )
})
