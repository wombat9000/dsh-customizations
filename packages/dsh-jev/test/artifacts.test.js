import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { buildHost } from '../scripts/build-host.mjs'
import { buildClient, clientPath } from '../scripts/build-client.mjs'
import { checkHost } from '../../../scripts/build-host.mjs'
import { typecheck } from '../scripts/typecheck.mjs'

const client = readFileSync(clientPath, 'utf8')

test('strict host/client contracts and generated artifacts remain current', async () => {
  await typecheck()
  checkHost(buildHost())
  assert.equal(await buildClient(), client)
})

test('generated client retains lazy package identity and native settings registration', () => {
  let declaration
  vm.runInNewContext(client, {
    window: {
      __ModuleLoader__: {
        load(value) {
          declaration = value
        },
      },
    },
  })
  assert.equal(declaration.id, '@local/dsh-jev')
  let required
  const plugin = declaration.factory((name) => {
    required = name
    return {}
  })
  assert.equal(required, 'react')
  assert.deepEqual(Array.from(plugin.inject), ['slots', 'connection'])
  assert.equal(typeof plugin.SettingsCard, 'function')
  const rpc = {}
  let registration
  plugin.apply({
    get(name) {
      assert.equal(name, 'connection')
      return { rpc }
    },
    slots: {
      inject(name, callback) {
        assert.equal(name, 'plugins.row.config')
        callback()
      },
      register(options, component) {
        registration = { options, component }
      },
    },
  })
  assert.equal(registration.options.name, 'plugins.row.config')
  assert.equal(registration.options.key, '@local/dsh-jev#local-jev')
  assert.equal(registration.options.inject().rpc, rpc)
  assert.equal(registration.component, plugin.SettingsCard)
})
