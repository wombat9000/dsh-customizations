import assert from 'node:assert/strict'
import { cp, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import {
  auditRows,
  cli,
  declarations,
  fixture,
  flatten,
  host,
  json,
  lease,
  livePresetMounts,
  parse,
  recipeRows,
  repo,
  snapshot,
  standardPatch,
  webRoot,
} from './fixtures.js'

// Both composition-only bundles obey the same 0.1.7-rc.2 contract.
export function presetRegressions({ id, name, skill, marker, resource }) {
  test(`${name}: publication and additive recipe declarations`, async (t) => {
    const f = await fixture(t, id)
    const manifest = await json(join(f.packaged, 'package.json'))
    assert.equal(manifest.name, `@local/dsh-${id}`)
    assert.equal(manifest.exports['./package.json'], './package.json')
    assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
    assert.equal((await json(cli.resolve('@deepseek-ai/dsh/package.json'))).version, '0.1.7-rc.2')
    assert.equal(manifest.main, undefined)
    assert.equal(manifest.dependencies, undefined)
    assert.equal(manifest.devDependencies, undefined)
    assert.deepEqual(Object.keys(manifest.scripts), ['test'])
    assert.deepEqual(Object.keys(manifest.dsh), ['bundle'])
    const patch = join(f.packaged, 'cordis.patch.yml')
    const own = declarations([patch])
    assert.equal(own.length, 1)
    assert.equal(own[0].id, `local-preset-${id}`)
    assert.equal(own[0].name, '@deepseek-ai/dsh-agent-preset')
    assert.equal(own[0].config.id, id)
    assert.equal(own[0].config.name, name)
    assert.ok(own[0].config.description)
    assert.ok(Array.isArray(own[0].config.plugins))
    assert.doesNotMatch(
      await readFile(patch, 'utf8'),
      /includeShippedRoot|includeUserRoot|trust:|roots:/,
    )
    const packagedPresets = await snapshot(join(f.packaged, 'presets', id))
    assert.deepEqual(Object.keys(packagedPresets).sort(), ['LICENSE.standard', 'skills'])
    assert.ok(packagedPresets.skills[skill]['SKILL.md'])
    assert.equal(
      await readFile(join(f.packaged, 'presets', id, 'LICENSE.standard'), 'utf8'),
      await readFile(join(webRoot, 'LICENSE'), 'utf8'),
    )
    const recipe = await recipeRows()
    for (const preset of [
      'standard',
      'ptc',
      'minimal',
      'cordis',
      'worktree-coordinator',
      'project-steward',
      'product-mode',
    ])
      assert.equal(
        recipe.filter(
          (row) => row.name === '@deepseek-ai/dsh-agent-preset' && row.config.id === preset,
        ).length,
        1,
        preset,
      )
    assert.deepEqual(flatten(recipe).find((row) => row.id === 'agent-preset-registry').config, {
      default: 'standard',
    })
    const { ctx } = await host(t, f, declarations([standardPatch, patch]))
    assert.equal(ctx.get('agentPresets').defaultId, 'standard')
    const listed = await ctx.get('agentPresets').list()
    assert.deepEqual(
      listed.map((row) => row.id),
      ['standard', id],
    )
    for (const row of listed) assert.equal(row.broken, undefined, row.broken)
  })

  test(`${name}: exact installed Standard parity except persona, skill and enabled Ralph`, async (t) => {
    const f = await fixture(t, id)
    const standard = declarations([standardPatch])[0].config.plugins
    const custom = declarations([join(f.packaged, 'cordis.patch.yml')])[0].config.plugins
    const persona = custom.find((row) => row.id === 'persona').config
    assert.equal(persona.text, undefined)
    assert.equal(persona.core, undefined)
    assert.ok(persona.prefix.includes(name))
    assert.ok(persona.prefix.includes('{{model}}'))
    assert.ok(persona.suffix.includes('Your working directory is {{cwd}}.'))
    assert.ok(persona.suffix.includes(`Load the ${skill} skill`))
    const extra = custom.filter((row) => row.id === `local-${id}-skills`)
    assert.equal(extra.length, 1)
    assert.equal(extra[0].name, '@deepseek-ai/dsh-skill-filesystem')
    assert.equal(extra[0].config.providerName, `${id}-bundled`)
    assert.equal(extra[0].config.includeDefaultRoots, false)
    assert.equal(extra[0].config.watch, false)
    const normalized = custom.filter((row) => row !== extra[0])
    normalized.find((row) => row.id === 'persona').config = standard.find(
      (row) => row.id === 'persona',
    ).config
    const ralph = flatten(normalized).find((row) => row.id === 'tool-ralph')
    assert.equal(ralph.disabled, undefined)
    assert.deepEqual(ralph.config, { subagentProvider: 'spawn', maxRounds: 64 })
    ralph.disabled = true
    assert.deepEqual(normalized, standard)
    assert.ok(
      !flatten(custom).some((row) =>
        /@local\/dsh-github|dsh-(tool-cordis|cordis-runtime|workflow-worker-thread)/.test(row.name),
      ),
    )
  })

  test(
    `${name}: real skill mounts, shared host tools and retained revision lifecycle`,
    { timeout: 20000 },
    async (t) => {
      const f = await fixture(t, id)
      await mkdir(join(f.directory, '.git'))
      const setupPath = join(f.directory, '.agents/skills/repository-setup/SKILL.md')
      await mkdir(dirname(setupPath), { recursive: true })
      await cp(join(repo, '.agents/skills/repository-setup/SKILL.md'), setupPath)
      const rows = declarations([standardPatch, join(f.packaged, 'cordis.patch.yml')])
      const { ctx, tree, calls } = await host(t, f, rows)
      const before = await snapshot(f.directory)
      const roster = ctx.get('agentPresets')
      const document = await roster.readDocument(id)
      assert.match(document.content, /!!js .*createRequire\(root\.baseUrl\)/)
      assert.deepEqual(
        parse(document.content),
        rows.find((row) => row.config.id === id).config.plugins,
      )
      const standard = await lease(t, roster, 'standard')
      const own = await lease(t, roster, id)
      const same = await lease(t, roster, id)
      assert.notEqual(own.key, standard.key)
      assert.equal(same.key, own.key)
      const names = (key) => [...ctx.get('tools').view(key).visible.keys()].sort()
      assert.deepEqual(
        names(own.key).filter((name) => name !== 'ralph'),
        names(standard.key),
      )
      assert.ok(names(own.key).includes('ralph'))
      assert.ok(names(own.key).length > 38)
      const globalNames = names()
      assert.equal(globalNames.length, 31)
      for (const name of globalNames) {
        assert.ok(name.startsWith('github_'))
        assert.equal(ctx.get('tools').get(name, own.key), ctx.get('tools').get(name))
      }
      for (const service of ['planMode', 'compaction', 'toolResultPruner', 'workflowEngine'])
        assert.equal(ctx.get(service), undefined)
      const skills = ctx.get('skills')
      const options = { scope: own.key, cwd: f.directory }
      const summary = (await skills.list(options)).find((entry) => entry.name === skill)
      assert.ok(summary)
      assert.equal(summary.content, undefined)
      const loaded = await skills.get(skill, options)
      assert.equal(loaded.source, 'bundled')
      assert.ok(loaded.content.includes(marker))
      assert.equal(loaded.resourceBase.path, join(f.packaged, 'presets', id, 'skills', skill))
      assert.equal(
        await readFile(join(loaded.resourceBase.path, resource), 'utf8'),
        await readFile(join(f.source, 'presets', id, 'skills', skill, resource), 'utf8'),
      )
      assert.equal(await skills.get(skill, { scope: standard.key, cwd: f.directory }), undefined)
      assert.equal(await skills.get(skill, { cwd: f.directory }), undefined)
      for (const scope of [own.key, standard.key]) {
        const setup = await skills.get('repository-setup', { scope, cwd: f.directory })
        assert.equal(setup.source, 'project-agents')
        assert.equal(setup.path, setupPath)
      }
      // Removing a declaration prevents new acquisition, but retained readers keep its revision.
      tree.remove(`local-preset-${id}`)
      await tree.await()
      await assert.rejects(roster.acquireScope(id), /Unknown agent preset/)
      assert.ok(await skills.get(skill, options))
      assert.ok(livePresetMounts(ctx.fiber).some((mount) => mount.key === own.key))
      await own[Symbol.asyncDispose]()
      await same[Symbol.asyncDispose]()
      assert.ok(!livePresetMounts(ctx.fiber).some((mount) => mount.key === own.key))
      assert.equal(await skills.get(skill, options), undefined)
      const restored = declarations([join(f.packaged, 'cordis.patch.yml')])[0]
      await tree.create(restored)
      await tree.await()
      const next = await lease(t, roster, id)
      assert.notEqual(next.key, own.key)
      assert.ok(await skills.get(skill, { ...options, scope: next.key }))
      assert.deepEqual(calls, [])
      assert.deepEqual(
        await snapshot(f.directory),
        before,
        'mounting and lifecycle create no state or drafts',
      )
    },
  )

  test(`${name}: Loader volatile default changes without registry or declaration remount`, async (t) => {
    const f = await fixture(t, id)
    const rows = declarations([standardPatch, join(f.packaged, 'cordis.patch.yml')])
    const { ctx, tree } = await host(t, f, rows, { selectedDefault: id })
    const roster = ctx.get('agentPresets')
    const own = await lease(t, roster, id)
    assert.equal(roster.defaultId, id)
    assert.equal((await roster.resolve()).id, id)
    const row = tree.resolve('agent-preset-registry')
    const fiber = row.fiber
    await row.update({ config: { default: 'standard', selectedDefault: 'standard' } })
    await tree.await()
    assert.ok(
      tree.resolve('agent-preset-registry').fiber === fiber,
      'registry fiber remains active',
    )
    // Context.get returns traceable wrappers; compare the owning fiber and retained
    // scope, not wrapper identity. The captured service must observe the new value.
    assert.equal(roster.defaultId, 'standard')
    assert.equal((await lease(t, roster, id)).key, own.key)
    await row.update({ config: { default: 'standard' } })
    await tree.await()
    assert.equal(roster.defaultId, 'standard')
    assert.equal(
      (await roster.remoteExportList()).presets.find((row) => row.isDefault).id,
      'standard',
    )
  })

  test(`${name}: duplicate declaration IDs fail without shadowing the registered preset`, async (t) => {
    const f = await fixture(t, id)
    // Empty plugin arrays keep this test focused on registration, not tool mounting.
    const declaration = declarations([join(f.packaged, 'cordis.patch.yml')])[0]
    declaration.config.plugins = []
    const { ctx, tree } = await host(t, f, [declaration], { full: false, selectedDefault: id })
    const roster = ctx.get('agentPresets')
    const original = await lease(t, roster, id)
    await tree.create({
      ...declaration,
      id: 'collision',
      config: { ...declaration.config, name: 'Impostor' },
    })
    await tree.await()
    const audit = await auditRows(tree)
    assert.ok(
      audit.failed.some((line) => line.includes(`Duplicate agent preset: ${id}`)),
      audit.failed.join('\n'),
    )
    const listed = await roster.list()
    assert.equal(listed.length, 1)
    assert.equal(listed[0].name, name)
    assert.equal((await lease(t, roster, id)).key, original.key)
    assert.equal((await roster.resolve()).id, id)
    tree.remove('collision')
    await tree.await()
    assert.equal((await roster.list()).length, 1)
    // Read-only documents retain entry-list syntax rather than copying a directory.
    assert.deepEqual(parse((await roster.readDocument(id)).content), [])
  })
}
