import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

/**
 * Evaluate a built DSH client bundle in an isolated VM context and invoke its
 * lazy `__ModuleLoader__` factory with a React-only require table by default.
 */
export function loadClientBundle(bundlePath, options = {}) {
  const { react = {}, modules, window: extraWindow = {}, globals = {}, expectedId } = options
  const source = options.source ?? readFileSync(bundlePath, 'utf8')
  const registrations = []
  const context = {
    ...globals,
    window: {
      ...extraWindow,
      __ModuleLoader__: {
        load(registration) {
          registrations.push(registration)
        },
      },
    },
  }
  vm.runInNewContext(source, context)
  assert.equal(registrations.length, 1, 'Expected client bundle to register exactly one module')
  const [record] = registrations
  if (expectedId !== undefined) assert.equal(record.id, expectedId)
  const requested = []
  const plugin = record.factory((name) => {
    requested.push(name)
    if (modules && Object.hasOwn(modules, name)) return modules[name]
    assert.equal(name, 'react', `Unexpected external module request: ${name}`)
    return react
  })
  return { id: record.id, record, plugin, exports: plugin, requested, source }
}
