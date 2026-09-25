import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import { buildClient, clientPath } from '../scripts/build-client.mjs'
import { typecheck } from '../scripts/typecheck.mjs'

test('GitHub client and compile-only contract regressions pass strict typechecking', async () => {
  await typecheck()
})

test('committed GitHub client matches reproducible source assembly', async () => {
  const first = await buildClient()
  assert.equal(first, await buildClient())
  assert.equal(
    await readFile(clientPath, 'utf8'),
    first,
    'Run node packages/dsh-github/scripts/build-client.mjs',
  )
})

test('GitHub assembly registers one lazy factory and retains its complete public surface', async () => {
  const source = await readFile(clientPath, 'utf8')
  const registrations = []
  // At script evaluation there are no React, require, exports, module, or process globals.
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: (registration) => registrations.push(registration) } },
  })
  assert.equal(registrations.length, 1)
  const [{ id, factory }] = registrations
  assert.equal(id, '@local/dsh-github')
  const requested = []
  const plugin = factory((name) => {
    requested.push(name)
    assert.equal(name, 'react', 'DSH supplies all client externals')
    return {}
  })
  assert.deepEqual([...new Set(requested)], ['react'])
  assert.deepEqual(Array.from(plugin.inject), ['slots'])
  assert.deepEqual(
    Object.keys(plugin).sort(),
    [
      'inject',
      'approvalModel',
      'selectApproval',
      'ApprovalPreview',
      'NativeApprovalDetail',
      'api',
      'safeUrl',
      'validScope',
      'validStatus',
      'rawDetails',
      'phaseLabel',
      'Scope',
      'GrantCard',
      'fieldValueModel',
      'validFieldStatus',
      'fieldResult',
      'fieldPhase',
      'fieldPhaseLabel',
      'FieldChangeCard',
      'READ_TOOLS',
      'readWarnings',
      'readCardModel',
      'itemFieldModel',
      'projectItemModel',
      'ReadCard',
      'apply',
    ].sort(),
  )
  assert.doesNotMatch(source, /dangerouslySetInnerHTML/)
})
