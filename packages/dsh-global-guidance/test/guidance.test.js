import assert from 'node:assert/strict'
import { cp, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { buildHost } from '../scripts/build-host.mjs'
import { checkHost } from '../../../scripts/build-host.mjs'
import {
  declarations,
  fixture,
  host,
  installed,
  lease,
  recipeRows,
  standardPatch,
} from '../../dsh-product-mode/test/fixtures.js'

const root = new URL('../', import.meta.url)
const sectionName = 'global-guidance:visual-evidence'
const rowId = 'local-global-guidance-visual-evidence'
const packageName = '@local/dsh-global-guidance'
const { createScope, scopeOf } = await installed('@deepseek-ai/dsh-scope')
const { renderPrompt } = await installed('@deepseek-ai/dsh-system-prompt')
const { readPluginMeta } = await installed('@deepseek-ai/dsh-app-boot')

// Reuse the dormant Standard/Product host; publish only the manifest's file set
// into its temporary profile. No live state, provider, browser or tool execution.
async function guidanceHost(t) {
  const f = await fixture(t)
  const packaged = join(f.directory, 'node_modules', '@local', 'dsh-global-guidance')
  await mkdir(packaged)
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  for (const file of ['package.json', ...manifest.files])
    await cp(new URL(file, root), join(packaged, file), { recursive: true })
  const rows = declarations([
    standardPatch,
    join(f.packaged, 'cordis.patch.yml'),
    join(packaged, 'cordis.patch.yml'),
  ])
  return { ...(await host(t, f, rows)), packaged, directory: f.directory }
}

test('strict host build and committed publication output stay reproducible', () => {
  const first = buildHost()
  assert.deepEqual([...first.files], [...buildHost().files])
  checkHost(first)
})

test('published guidance reaches preset and child scopes and follows the real Loader lifetime', async (t) => {
  const { ctx, tree, packaged } = await guidanceHost(t)
  const base = pathToFileURL(join(packaged, 'package.json')).href
  // Exercise DSH's dictionary discovery, not just each JSON file in isolation:
  // unrelated JSON siblings or incorrect export addresses must fail here.
  for (const [specifier, title] of [
    [packageName, 'Global Guidance'],
    [`${packageName}/visual-evidence`, 'Visual evidence'],
  ]) {
    const metadata = readPluginMeta(specifier, base)
    assert.equal(metadata?.error, undefined)
    assert.equal(metadata?.title?.en, title)
  }
  const body = await readFile(join(packaged, 'assets', 'visual-evidence.md'), 'utf8')
  const registry = ctx.get('systemPrompt')
  const presets = ctx.get('agentPresets')
  const standard = await lease(t, presets, 'standard')
  const product = await lease(t, presets, 'product-mode')
  const parent = createScope(ctx, {})
  await presets.mount(parent.ctx, 'standard')
  const child = createScope(ctx, {})
  assert.equal(presets.composeFrom(child.ctx, parent.ctx), 'standard')
  t.after(async () => {
    await child.dispose()
    await parent.dispose()
  })
  const scopes = [undefined, standard.key, product.key, scopeOf(parent.ctx), scopeOf(child.ctx)]
  const snapshot = () => Promise.all(scopes.map((scope) => registry.assemble({ scope })))
  ctx.systemPrompt.section({ name: 'test:unrelated', order: 9040, text: 'Unrelated guidance' })
  const initial = await snapshot()
  const persona = (assembly) =>
    assembly.sections.find((s) => s.name === 'deployment:persona-prefix')
  assert.notDeepEqual(persona(initial[1]), persona(initial[2]))
  const check = async (enabled) => {
    const current = await snapshot()
    for (const [index, assembly] of current.entries()) {
      assert.deepEqual(
        assembly.sections.filter((section) => section.name === sectionName),
        enabled ? [{ name: sectionName, text: body, interpolate: false }] : [],
      )
      assert.ok(assembly.sections.some((s) => s.name === 'test:unrelated'))
      assert.deepEqual(persona(assembly), persona(initial[index]))
    }
    // Render the real registry's global assembly, not a parallel test renderer.
    if (enabled) assert.ok(renderPrompt(current[0]).includes(body))
  }
  await check(true)
  const entry = tree.resolve(rowId)
  for (const enabled of [false, true, false, true]) {
    await entry.update({ disabled: !enabled })
    await tree.await()
    await check(enabled)
  }
  // A deliberate complete persona remains authoritative; global guidance must
  // not bypass this native opt-out. Removing it reveals the contribution again.
  const override = child.ctx.plugin({
    inject: ['systemPrompt'],
    apply(owner) {
      owner.systemPrompt.section({
        name: 'test:complete',
        order: 0,
        complete: true,
        text: 'Complete child prompt',
      })
    },
  })
  await override.await()
  assert.deepEqual((await registry.assemble({ scope: scopeOf(child.ctx) })).sections, [
    { name: 'test:complete', text: 'Complete child prompt' },
  ])
  await override.dispose()
  await check(true)
  await entry.fiber.dispose()
  await check(false)
})

test('the profile selects guidance globally without copying it into presets', async () => {
  const rows = await recipeRows()
  assert.equal(rows.filter((row) => row.name === `${packageName}/visual-evidence`).length, 1)
  for (const preset of rows.filter((row) => row.name === '@deepseek-ai/dsh-agent-preset')) {
    assert.equal(
      preset.config.plugins.some((row) => row.name?.startsWith(`${packageName}/`)),
      false,
      `${preset.config.id} inherits the host contribution`,
    )
  }
})
