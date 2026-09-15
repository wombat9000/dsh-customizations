import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { apply, GEMINI_CREDENTIAL_REF, GeminiImageClient } from '../src/index.js'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const json = async (relative) => JSON.parse(await readFile(new URL(relative, import.meta.url), 'utf8'))

// Repository wiring only: never install into a user profile or invoke Gemini.
// Real Loader/Web coexistence is exercised by tests/real-ui/migration-boot.mjs.
test('personal-web selects imagegen once after base, Web and shared Gemini credentials UI', async () => {
  const manifest = await json('../package.json')
  const recipe = await json('../../../profiles/personal-web/recipe.json')
  const selected = recipe.bundles.filter(({ name }) => name === manifest.name)
  assert.equal(manifest.name, '@local/dsh-tool-imagegen')
  assert.equal(selected.length, 1)
  assert.equal(selected[0].source, '../../packages/dsh-tool-imagegen')
  const index = recipe.bundles.indexOf(selected[0])
  for (const name of ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@local/dsh-tool-youtube']) {
    const prerequisite = recipe.bundles.findIndex((bundle) => bundle.name === name)
    assert.ok(prerequisite >= 0 && prerequisite < index, name)
  }
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.deepEqual(manifest.dsh.client.inject, ['@deepseek-ai/dsh-client-ui-conversation'])
  assert.equal(manifest.dsh.client.platform, 'web')
  for (const section of ['dependencies', 'peerDependencies', 'devDependencies', 'optionalDependencies']) {
    for (const [name, version] of Object.entries(manifest[section] ?? {})) {
      if (/^@deepseek-ai\/dsh(?:$|-)/.test(name)) assert.equal(version, '0.1.5-rc.2', name)
    }
  }
  const youtube = await json('../../dsh-tool-youtube/package.json')
  assert.equal(manifest.dependencies['@google/genai'], youtube.dependencies['@google/genai'])
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.match(patch, /- insert:\s+- id: local-tool-imagegen\s+name: '@local\/dsh-tool-imagegen'/)
  assert.doesNotMatch(patch, /apiKey|GEMINI_API_KEY|agent-presets|searchProvider|fetchProvider/)
  const result = spawnSync(process.execPath, ['scripts/apply-profile.mjs', '--', 'personal-web', '--dry-run'], {
    cwd: ROOT, encoding: 'utf8', timeout: 10000, env: { PATH: process.env.PATH },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Applying @local\/dsh-tool-imagegen to profile personal-web/)
  assert.match(result.stdout, /Dry run complete/)
})

test('host resolves the shared credential on each invocation without a second settings/provider registration', async (t) => {
  // Intercept before SDK construction: no Gemini call even with fixture keys.
  t.mock.method(GeminiImageClient.prototype, 'generate', async function () { return this.apiKey() })
  let key = 'fixture-first'
  const refs = [], definitions = [], sections = []
  const ctx = {
    attachments: {},
    get(name) {
      assert.equal(name, 'credentials')
      return { async resolve(ref) { refs.push(ref); return key ? { value: key } : undefined } }
    },
    tools: { register(definition) { definitions.push(definition) } },
    systemPrompt: { section(section) { sections.push(section) } },
  }
  apply(ctx)
  assert.equal(definitions.length, 1)
  assert.equal(definitions[0].name, 'generate_image')
  assert.match(sections[0].text, /only when the user asks/)
  assert.match(sections[0].text, /external provider cost/)
  assert.match(sections[0].text, /untrusted data/)
  assert.equal(await definitions[0].execute({ prompt: 'fixture' }, {}), 'fixture-first')
  key = 'fixture-rotated'
  assert.equal(await definitions[0].execute({ prompt: 'fixture' }, {}), 'fixture-rotated')
  key = undefined
  await assert.rejects(definitions[0].execute({ prompt: 'fixture' }, {}), /GEMINI_API_KEY is not configured/)
  assert.deepEqual(refs, Array(3).fill(GEMINI_CREDENTIAL_REF))
  definitions.length = 0
  apply(ctx, { apiKey: 'fixture-literal' })
  assert.equal(await definitions[0].execute({ prompt: 'fixture' }, {}), 'fixture-literal')
  assert.equal(refs.length, 3, 'literal override does not query shared credentials')
  definitions.length = 0
  apply(ctx, { generate: false })
  assert.equal(definitions.length, 0, 'disabled generation registers no tool')
})
