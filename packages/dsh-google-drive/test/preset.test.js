import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  cli,
  installed,
  declarations,
  flatten,
  recipeRows,
} from '../../dsh-product-mode/test/fixtures.js'

// Compose actual published target patches; no live profile or execution.
const { loadOverlayPatches, composeEntries } = await installed('@deepseek-ai/dsh-app-boot')
const drivePatch = fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))
const presetRows = (rows) =>
  flatten(rows).filter((row) =>
    ['@deepseek-ai/dsh-agent-preset', '@deepseek-ai/dsh-agent-preset-registry'].includes(row.name),
  )

test('Drive adds no preset and personal-web preserves shipped and custom declarations', async () => {
  const manifestPath = cli.resolve('@deepseek-ai/dsh-web-app/package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const baseManifestPath = cli.resolve('@deepseek-ai/dsh-base/package.json')
  const baseManifest = JSON.parse(await readFile(baseManifestPath, 'utf8'))
  const patches = [
    ...[baseManifest.dsh.bundle.patch]
      .flat()
      .map((patch) => join(dirname(baseManifestPath), patch)),
    ...[manifest.dsh.bundle.patch].flat().map((patch) => join(dirname(manifestPath), patch)),
  ]
  const base = presetRows(declarations(patches))
  assert.deepEqual(presetRows(declarations([...patches, drivePatch])), base)
  const combined = presetRows(await recipeRows())
  assert.equal(
    combined.find((row) => row.name.endsWith('preset-registry')).config.default,
    'standard',
  )
  const ids = combined
    .filter((row) => row.name === '@deepseek-ai/dsh-agent-preset')
    .map((row) => row.config.id)
  assert.deepEqual(ids.sort(), [
    'cordis',
    'file-intuition',
    'minimal',
    'product-mode',
    'project-steward',
    'ptc',
    'standard',
    'worktree-coordinator',
  ])
  assert.equal(ids.includes('google-drive'), false)
})

test('Drive insertion preserves arbitrary explicit preset declaration and saved default', () => {
  const registry = {
    id: 'agent-preset-registry',
    name: '@deepseek-ai/dsh-agent-preset-registry',
    config: { default: 'custom', selectedDefault: 'custom' },
  }
  const custom = {
    id: 'custom-preset-row',
    name: '@deepseek-ai/dsh-agent-preset',
    config: { id: 'custom', name: 'Custom', plugins: [] },
  }
  const rows = composeEntries([
    [{ insert: [registry, custom] }],
    loadOverlayPatches('drive-test', drivePatch),
  ])
  assert.deepEqual(presetRows(rows), [registry, custom])
})
