import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { loadClientBundle } from '../../../tests/helpers/load-client-bundle.mjs'

test('Projects lazy factory registers exact root seats and releases registrations', () => {
  const { plugin } = loadClientBundle(new URL('../client.js', import.meta.url), {
    react: React,
    expectedId: '@local/dsh-projects',
  })
  assert.deepEqual(Array.from(plugin.inject), ['slots', 'connection', 'locale'])
  const seats = [],
    cleanups = [],
    disposed = []
  plugin.apply({
    connection: {
      rpc: {
        call: () => {
          throw new Error('Registration must not fetch data')
        },
      },
    },
    effect: (callback) => cleanups.push(callback()),
    locale: {
      register: () => () => disposed.push('locale'),
      bind: () => (key) => key,
      subscribe: () => () => {},
      getSnapshot: () => 'en',
    },
    slots: {
      inject: (_name, callback) => cleanups.push(callback()),
      register: (options, component) => {
        seats.push([options, component])
        return () => disposed.push(options.name)
      },
    },
  })
  assert.equal(typeof seats[0][0].label, 'function')
  assert.equal(seats[0][0].label(), 'Projects')
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        seats.map(([options]) => ({
          ...options,
          ...(typeof options.label === 'function' ? { label: options.label() } : {}),
        })),
      ),
    ),
    [
      { name: 'sidebar.panellist', id: 'local-projects', label: 'Projects', order: 10 },
      { name: 'main', key: 'local-projects' },
    ],
  )
  const icon = seats[0][1]({ size: 19, active: true })
  assert.equal(icon.props.width, 19)
  for (const dispose of cleanups.reverse()) dispose()
  assert.deepEqual(disposed, ['main', 'sidebar.panellist', 'locale'])
})
