import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import * as plugin from '../dist/src/index.js'
import { buildHost } from '../scripts/build-host.mjs'
import { buildClient, clientPath } from '../scripts/build-client.mjs'
import { checkHost } from '../../../scripts/build-host.mjs'

const cli = createRequire(createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json'))
const installed = (name) => import(pathToFileURL(cli.resolve(name)).href)
const { Context } = await installed('@deepseek-ai/cordis')

test('tool runs through the real registry with bounded results and plugin-owned lifetime', async (t) => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  for (const name of ['system-prompt', 'tools']) {
    const module = await installed(`@deepseek-ai/dsh-${name}`)
    await ctx.plugin(module.default ?? module).await()
  }
  const fork = ctx.plugin(plugin)
  await fork.await()
  const tools = ctx.get('tools')
  const call = (args) =>
    tools.execute({
      name: 'suggest_replies',
      arguments: args,
      callId: 'fixture-call',
      signal: new AbortController().signal,
    })
  const result = await call({
    replies: [' Explain the tradeoff ', 'Add a regression test', 'Explain the tradeoff'],
  })
  assert.equal(result.isError, false)
  assert.deepEqual(result.value, { replies: ['Explain the tradeoff', 'Add a regression test'] })
  assert.deepEqual(result.content, [{ type: 'text', text: JSON.stringify(result.value) }])
  assert.deepEqual((await call({ replies: [] })).value, { replies: [] })
  assert.equal((await call({ replies: ['x'.repeat(120)] })).value.replies[0].length, 120)
  for (const args of [
    null,
    {},
    { replies: [''] },
    { replies: ['\t'] },
    { replies: ['a\nb'] },
    { replies: ['x'.repeat(121)] },
    { replies: ['a', 'b', 'c', 'd'] },
    { replies: [2] },
    { replies: ['ok'], extra: true },
  ]) {
    assert.equal((await call(args)).isError, true, JSON.stringify(args))
  }
  const prompt = await ctx.get('systemPrompt').assemble({})
  assert.ok(
    prompt.sections.some(
      (section) =>
        section.name === 'suggest-replies:guidance' && section.text.includes('user’s voice'),
    ),
  )
  await fork.dispose()
  assert.equal(tools.get('suggest_replies'), undefined)
  assert.equal(
    (await ctx.get('systemPrompt').assemble({})).sections.some(
      (section) => section.name === 'suggest-replies:guidance',
    ),
    false,
  )
})

test('strict builds reproduce published host and client artifacts', async () => {
  checkHost(buildHost())
  assert.equal(await buildClient(), await readFile(clientPath, 'utf8'))
})
