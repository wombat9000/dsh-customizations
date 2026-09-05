import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'

const require = createRequire(import.meta.url)
const bundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

function loadClient() {
  let registration
  const window = {
    __ModuleLoader__: {
      load(value) { registration = value },
    },
  }
  vm.runInNewContext(bundle, {
    window,
    console,
    AbortController,
    AbortSignal,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  })
  assert.equal(registration.id, '@local/dsh-session-environment')
  return registration.factory((specifier) => {
    if (specifier === 'react') return require('react')
    throw new Error(`unexpected external ${specifier}`)
  })
}

test('client bundle exports home-relative middle path compaction', () => {
  const client = loadClient()
  assert.equal(client.compactPath('/Users/tester', '/Users/tester'), '~')
  assert.equal(
    client.compactPath('/Users/tester/projects/harness/packages/plugin', '/Users/tester'),
    '~/…/packages/plugin',
  )
  assert.equal(client.compactPath('/short/path', '/Users/tester'), '/short/path')
})

test('client describes synced, ahead, behind, diverged, and no-upstream states', () => {
  const client = loadClient()
  assert.equal(client.describeSync('origin/main', 0, 0).label, 'Synced')
  assert.equal(client.describeSync('origin/main', 2, 0).label, '↑2')
  assert.equal(client.describeSync('origin/main', 0, 3).label, '↓3')
  assert.equal(client.describeSync('origin/main', 2, 3).label, '↑2 ↓3')
  assert.equal(client.describeSync(null, null, null).label, 'No upstream')
  assert.match(client.describeSync('origin/main', 2, 3).title, /last-fetched upstream state/)
})

test('client self-mounts its Remote contribution and overlay slot', async () => {
  const client = loadClient()
  const calls = []
  const mountedRemote = { async read() { throw new Error('not called by this test') } }
  const ctx = {
    get(name) {
      assert.equal(name, 'remote.sessionEnvironment')
      return mountedRemote
    },
    remote: {
      async $mount(contribution) {
        calls.push(['mount', contribution.package, contribution.descriptors[0].method])
        return async () => { calls.push(['unmount']) }
      },
    },
    slots: {
      inject(name, callback) {
        calls.push(['inject', name])
        return callback()
      },
      register(descriptor, component) {
        calls.push(['register', descriptor.name, descriptor.id, typeof component])
        return () => { calls.push(['unregister']) }
      },
    },
  }

  const dispose = await client.apply(ctx)
  assert.deepEqual(calls.slice(0, 3), [
    ['mount', '@local/dsh-session-environment', 'read'],
    ['inject', 'shell.overlay'],
    ['register', 'shell.overlay', 'session-environment', 'function'],
  ])
  await dispose()
  assert.deepEqual(calls.slice(-2), [['unregister'], ['unmount']])
  assert.deepEqual(Array.from(client.inject), ['remote', 'slots'])
})
