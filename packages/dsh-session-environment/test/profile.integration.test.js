import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const json = async (relative) => JSON.parse(await readFile(new URL(relative, import.meta.url), 'utf8'))

// Adapted from the source package's standalone Web boot smoke test. Repository
// wiring checks must not install profiles or start another DSH instance.
test('portable recipe selects the local environment bundle after base and Web', async () => {
  const manifest = await json('../package.json')
  const recipe = await json('../../../profiles/personal-web/recipe.json')
  const matches = recipe.bundles.filter((bundle) => bundle.name === manifest.name)
  assert.equal(matches.length, 1)
  const index = recipe.bundles.findIndex((bundle) => bundle.name === manifest.name)
  for (const name of ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']) {
    const prerequisite = recipe.bundles.findIndex((bundle) => bundle.name === name)
    assert.ok(prerequisite >= 0, `Missing prerequisite bundle: ${name}`)
    assert.ok(index > prerequisite, `Session environment must follow ${name}`)
  }
  assert.equal(matches[0].source, '../../packages/dsh-session-environment')
  assert.equal(manifest.name, '@local/dsh-session-environment')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.deepEqual(manifest.dsh.client.inject, [
    '@deepseek-ai/dsh-api-remotes', '@deepseek-ai/dsh-client-ui-renderer',
  ])
  assert.equal(manifest.dsh.client.platform, 'web')
  for (const [name, version] of Object.entries({ ...manifest.dependencies, ...manifest.peerDependencies })) {
    if (name.startsWith('@deepseek-ai/dsh-')) assert.equal(version, '0.1.5-rc.1', name)
  }
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.match(patch, /- insert:\s+- id: local-session-environment\s+name: '@local\/dsh-session-environment'/)
  const result = spawnSync(process.execPath, ['scripts/apply-profile.mjs', '--', 'personal-web', '--dry-run'], {
    cwd: ROOT, encoding: 'utf8', timeout: 10000,
    env: { PATH: process.env.PATH },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Applying @local\/dsh-session-environment to profile personal-web/)
  assert.ok(result.stdout.includes(JSON.stringify(fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, ''))))
  assert.match(result.stdout, /Would run: .*"--dump-config"/)
  assert.match(result.stdout, /Dry run complete/)
})

test('build emits every declared runtime and type entrypoint', async () => {
  const manifest = await json('../package.json')
  for (const entry of Object.values(manifest.exports)) {
    for (const target of typeof entry === 'string' ? [entry] : Object.values(entry)) {
      await access(new URL(`../${target}`, import.meta.url))
    }
  }
  const host = await import('../lib/index.js')
  const remote = await import('../lib/types/remote.js')
  const typert = await import('../lib/types/typert.host.js')
  assert.deepEqual(host.default.inject, ['sessions', 'shell'])
  assert.equal(remote.default.package, manifest.name)
  assert.equal(typert.TYPERT.package, manifest.name)
  assert.equal(remote.default.descriptors[0].id, typert.TYPERT.invocations[0].id)
})
