import test from 'node:test'
import assert from 'node:assert/strict'
import { registerTypeScript } from './fixtures/typescript.mjs'
registerTypeScript()
const { normalizeSettings } = await import('../src/settings.ts')

test('settings defaults and strict validation', () => {
  assert.deepEqual(normalizeSettings(), {
    autoRecap: true,
    useJev: false,
    inactivityMinutes: 30,
    provider: '',
    model: '',
  })
  assert.throws(() => normalizeSettings({ useJev: 'true' }))
  for (const value of [0, -1, 1.1, Infinity, 10081, '30'])
    assert.throws(() => normalizeSettings({ inactivityMinutes: value }))
  assert.throws(() => normalizeSettings({ autoRecap: 'true' }))
  assert.throws(() => normalizeSettings({ provider: 'bad\nroute' }))
})
