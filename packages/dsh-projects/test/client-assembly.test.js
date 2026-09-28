import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import React from 'react'
import { buildClient, clientPath } from '../scripts/build-client.mjs'
import { typecheck } from '../scripts/typecheck.mjs'

test('Projects client passes strict typechecking', async () => {
  await typecheck()
})
test('Projects committed client is reproducible and fresh', async () => {
  const first = await buildClient()
  assert.equal(first, await buildClient())
  assert.equal(await readFile(clientPath, 'utf8'), first)
})
test('Projects lazy factory registers exact root seats and releases registrations', async () => {
  const registrations = []
  vm.runInNewContext(await readFile(clientPath, 'utf8'), {
    window: { __ModuleLoader__: { load: (value) => registrations.push(value) } },
  })
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].id, '@local/dsh-projects')
  const plugin = registrations[0].factory((name) => {
    assert.equal(name, 'react')
    return React
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
