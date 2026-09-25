import assert from 'node:assert/strict'
import test from 'node:test'
import { registerTypeScript } from './fixtures/typescript.mjs'

registerTypeScript()
const { adaptRpc, unwrap, errorMessage } = await import('../client/rpc.ts')
const { createController } = await import('../client/controller.ts')

test('typed RPC adapter preserves transport identity, receiver, and response', async () => {
  const response = { ok: true, value: { provider: 'fixture', model: 'summary' } }
  const raw = {
    async call(channel, endpoint, payload) {
      assert.equal(this, raw)
      assert.equal(channel, '/session-recap')
      assert.equal(endpoint, 'settings')
      assert.deepEqual(payload, {})
      return response
    },
  }
  const rpc = adaptRpc(raw)
  assert.equal(rpc, raw)
  assert.equal(adaptRpc(raw), rpc, 'stable transport props must not restart React effects')
  assert.equal(await rpc.call('/session-recap', 'settings', {}), response)
})

test('RPC failure envelopes retain runtime checks after typing', () => {
  assert.throws(() => unwrap({ ok: false, error: { message: 'Configured route failed' } }), {
    message: 'Configured route failed',
  })
  for (const response of [null, undefined, {}, { ok: false }]) {
    assert.throws(() => unwrap(response), { message: 'Session recap is unavailable.' })
  }
  const value = { bullets: ['A recap'] }
  assert.equal(unwrap({ ok: true, value }), value)
})

test('unknown errors become text without trusting non-string message properties', () => {
  for (const [error, expected] of [
    [new Error('Failed'), 'Failed'],
    ['Failed', 'Failed'],
    [null, 'null'],
    [undefined, 'undefined'],
    [42, '42'],
    [{ message: 23 }, '[object Object]'],
    [{ message: 'Explicit message' }, 'Explicit message'],
  ])
    assert.equal(errorMessage(error), expected)
})

test('malformed transport rejections cannot corrupt controller error state', async () => {
  for (const error of [null, undefined, { message: 23 }]) {
    const controller = createController({
      rpc: {
        call: async () => {
          throw error
        },
      },
    })
    await controller.recap('fixture')
    assert.equal(controller.getSnapshot('fixture').busy, false)
    assert.equal(controller.getSnapshot('fixture').error, String(error))
  }
})
