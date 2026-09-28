import assert from 'node:assert/strict'
import { readFile, mkdir, mkdtemp, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildHost } from '../scripts/build-host.mjs'
import { typecheck } from '../scripts/typecheck.mjs'
import { checkHost } from '../../../scripts/build-host.mjs'
import { createScoutSkillProvider } from '../dist/src/skill.js'
import { collectFiles } from '../dist/src/files.js'
import { parseRequest } from '../dist/src/engine.js'
import * as Scout from '../dist/src/index.js'
import {
  Context,
  installed,
  declarations,
  standardPatch,
  recipeRows,
} from '../../dsh-product-mode/test/fixtures.js'

const patch = new URL('../cordis.patch.yml', import.meta.url)
test('strict types, generated reproducibility and committed artifact freshness', async () => {
  await typecheck()
  const first = buildHost()
  assert.deepEqual([...first.files], [...buildHost().files])
  checkHost(first)
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.name, '@local/dsh-file-intuition')
  assert.equal(Scout.name, 'file-intuition')
  assert.equal(
    import.meta.resolve('@local/dsh-file-intuition'),
    new URL('../dist/src/index.js', import.meta.url).href,
  )
  assert.equal(manifest.main, 'dist/src/index.js')
  assert.equal(manifest.dsh.client, undefined)
  assert.deepEqual(Scout.inject, ['tools', 'fs', 'skills'])
})

test('additive preset preserves the Standard roster and default', async () => {
  const base = declarations([standardPatch])
  const combined = declarations([standardPatch, patch.pathname])
  assert.deepEqual(
    combined.find((row) => row.config.id === 'standard'),
    base[0],
  )
  const scout = combined.find((row) => row.config.id === 'file-intuition')
  assert.equal(scout.config.name, 'File Intuition')
  assert.equal(scout.name, '@deepseek-ai/dsh-agent-preset')
  const original = base[0].config.plugins
  const actual = scout.config.plugins
  assert.deepEqual(
    actual.filter((row) => !['persona', 'file-intuition'].includes(row.id)),
    original.filter((row) => row.id !== 'persona'),
  )
  assert.equal(actual.filter((row) => row.name === '@local/dsh-file-intuition').length, 1)
  assert.equal(
    combined.some((row) => row.name === '@local/dsh-file-intuition'),
    false,
  )
  const recipe = await recipeRows()
  assert.equal(recipe.filter((row) => row.config?.id === 'file-intuition').length, 1)
  const license = await readFile(new URL('../assets/LICENSE.standard', import.meta.url), 'utf8')
  assert.match(license, /Copyright \(c\) 2026 DeepSeek/)
})

test('bundled skill asset loads from emitted entrypoint and honors cancellation', async () => {
  const provider = createScoutSkillProvider()
  const candidates = await provider.list({})
  assert.equal(candidates.length, 1)
  const skill = await provider.get(candidates[0], {})
  assert.equal(skill.name, 'file-intuition')
  assert.equal(skill.provider, 'file-intuition-bundled')
  assert.match(skill.content, /^# File intuition/m)
  assert.match(skill.description, /Reference/)
  assert.match(skill.content, /## Result envelope and failure semantics/)
  assert.doesNotMatch(skill.content, /^## .*workflow/im)
  assert.equal(await provider.get({ ...candidates[0], name: 'repository-scout' }, {}), undefined)
  assert.deepEqual(skill.invocation, { modelInvocable: true, userInvocable: true })
  for (const name of ['ask_file', 'classify_file', 'score_file', 'scout_files'])
    assert.ok(skill.content.includes(name))
  assert.match(skill.content, /Question IDs identify responses; Jev does not see the IDs/)
  assert.match(skill.content, /Secret|secret/)
  assert.equal(await provider.get({ ...candidates[0], name: 'unknown' }, {}), undefined)
  await assert.rejects(provider.get(candidates[0], { signal: AbortSignal.abort() }), {
    name: 'AbortError',
  })
})

test('reference input examples match the renamed tool contracts', async () => {
  const provider = createScoutSkillProvider()
  const [candidate] = await provider.list({})
  const { content } = await provider.get(candidate, {})
  const examples = [...content.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) =>
    JSON.parse(match[1]),
  )
  assert.equal(examples.length, 6)
  for (const [name, index, kind] of [
    ['ask_file', 0, 'boolean'],
    ['classify_file', 2, 'choice'],
    ['score_file', 4, 'score'],
    ['scout_files', 5, 'files'],
  ])
    assert.equal(parseRequest(name, examples[index]).kind, kind)
})

test('actual plugin mounts with native registries and publishes four typed tools', async (t) => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  for (const suffix of ['system-prompt', 'tools', 'skill']) {
    const plugin = await installed(`@deepseek-ai/dsh-${suffix}`)
    await ctx.plugin(plugin.default ?? plugin, {}).await()
  }
  ctx.provide('fs', {}) // Mounting must not read files or contact Jev.
  await ctx.plugin(Scout).await()
  for (const name of ['ask_file', 'classify_file', 'score_file', 'scout_files']) {
    const tool = ctx.get('tools').get(name)
    assert.ok(tool)
    assert.equal(tool.output.schema.type, 'object')
  }
})

test('real pinned local filesystem accepts safe source and rejects escaping symlinks', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'scout-native-fs-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const root = join(directory, 'repository')
  await mkdir(root)
  await writeFile(join(root, 'a.ts'), 'export const a = 1\n')
  await writeFile(join(directory, 'outside.ts'), 'export const privateValue = 2\n')
  await symlink(join(directory, 'outside.ts'), join(root, 'escape.ts'))
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  const { default: LocalFileSystem } = await installed('@deepseek-ai/dsh-fs-local')
  await ctx.plugin(LocalFileSystem, { cwd: directory }).await()
  const result = await collectFiles(
    ctx.get('fs'),
    root,
    { kind: 'files', pattern: '*.ts', question: 'Relevant?', maxFiles: 12 },
    new AbortController().signal,
  )
  assert.deepEqual(
    result.files.map((file) => file.path),
    ['a.ts'],
  )
  assert.ok(result.skipped.some((row) => ['outside_workspace', 'symlink'].includes(row.reason)))
  assert.equal(result.complete, true)
})
