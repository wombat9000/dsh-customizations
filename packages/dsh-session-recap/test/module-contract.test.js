import assert from 'node:assert/strict'
import test from 'node:test'
import * as runtime from '../dist/src/runtime.js'
import { RecapError } from '../dist/src/errors.js'
import { boundedHistory } from '../dist/src/history.js'
import { RECAP_PROMPT, parseCards, parseRecap } from '../dist/src/recap-schema.js'
import { DEFAULT_SETTINGS, LIMITS, normalizeSettings } from '../dist/src/settings.js'

test('runtime preserves its public helper exports after module extraction', () => {
  const helpers = {
    RecapError,
    boundedHistory,
    RECAP_PROMPT,
    parseCards,
    parseRecap,
    DEFAULT_SETTINGS,
    LIMITS,
    normalizeSettings,
  }
  for (const [name, implementation] of Object.entries(helpers)) {
    assert.equal(runtime[name], implementation, name)
  }
})

test('standalone parsers and settings use the same error class as the runtime', () => {
  const cases = [
    () => parseRecap('{}'),
    () => parseCards('{}', ['direction']),
    () => normalizeSettings({ inactivityMinutes: 0 }),
  ]
  for (const call of cases) {
    assert.throws(call, (error) => error instanceof runtime.RecapError)
  }
})
