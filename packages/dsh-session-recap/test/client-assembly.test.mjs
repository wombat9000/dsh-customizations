import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import assert from 'node:assert/strict'
import { assembleClient, clientPath } from '../scripts/build-client.mjs'
import { CARD_LABELS, CARD_TITLES } from '../src/cards.js'

const source = readFileSync(clientPath, 'utf8')

test('committed client entry matches deterministic source assembly', () => {
  assert.equal(assembleClient(), assembleClient())
  assert.equal(source, assembleClient(), 'Run node packages/dsh-session-recap/scripts/build-client.mjs')
})

test('client registers one lazy factory with the original exports and only React as an external', () => {
  const registrations = []
  const window = { __ModuleLoader__: { load: (registration) => registrations.push(registration) } }
  vm.runInNewContext(source, { window, setTimeout, clearTimeout })
  assert.equal(registrations.length, 1)
  const [{ id, factory }] = registrations
  assert.equal(id, '@wombat9000/dsh-session-recap')
  const requested = []
  const plugin = factory((name) => {
    requested.push(name)
    assert.equal(name, 'react')
    return {}
  })
  assert.deepEqual(requested, ['react'])
  assert.deepEqual(Object.keys(plugin), [
    'inject', 'apply', 'createController', 'RecapCard', 'RecapAction',
    'SettingsCard', 'CARD_LABELS', 'CHANNEL',
  ])
  assert.deepEqual(Array.from(plugin.inject), ['slots', 'connection', 'remote'])
  assert.equal(plugin.CHANNEL, '/session-recap')
  assert.deepEqual(Object.keys(plugin.CARD_LABELS), CARD_LABELS)
  for (const label of CARD_LABELS) {
    assert.equal(plugin.CARD_LABELS[label].title, CARD_TITLES[label])
  }
})
