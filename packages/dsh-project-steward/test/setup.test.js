import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const repo = fileURLToPath(new URL('../../../', import.meta.url))
const skillPath = join(repo, '.agents/skills/repository-setup/SKILL.md')
const templates = join(repo, 'packages/dsh-project-steward/presets/project-steward/skills/project-steward/templates/v1')
const text = path => readFile(path, 'utf8')

async function fresh(t, source = repo, env = process.env) {
  const root = await mkdtemp(join(tmpdir(), 'steward-fresh-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const directory = join(root, 'checkout')
  await mkdir(directory)
  // Copy repository files, not borrowed node_modules, Git metadata, or builds.
  // Include this change's untracked files so the test also runs before commit.
  // Container checkouts can have a different owner, and an isolated HOME hides
  // actions/checkout's global trust entry. Trust only this known source path for
  // this read-only command; do not change global config or trust other repos.
  const sourcePath = await realpath(source)
  const listed = spawnSync('git', ['-c', 'safe.directory=', '-c', `safe.directory=${sourcePath}`, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: sourcePath, env, encoding: 'utf8' })
  assert.equal(listed.status, 0, listed.stderr)
  for (const relative of new Set(listed.stdout.split('\0').filter(path => path && !path.split('/').includes('node_modules')))) {
    // Tracked deletions remain in ls-files until staged; omit them from the
    // current source snapshot just as we include untracked additions.
    try { await lstat(join(sourcePath, relative)) }
    catch (error) { if (error.code === 'ENOENT') continue; throw error }
    const target = join(directory, relative)
    await mkdir(dirname(target), { recursive: true })
    await cp(join(sourcePath, relative), target)
  }
  return { root, directory }
}

test('fresh fixture handles dubious source ownership without persisting Git trust', async t => {
  const root = await mkdtemp(join(tmpdir(), 'steward-ownership-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source')
  const home = join(root, 'home')
  await mkdir(source)
  await mkdir(home)
  const env = { PATH: process.env.PATH, HOME: home, XDG_CONFIG_HOME: home, GIT_CONFIG_NOSYSTEM: '1' }
  const git = args => spawnSync('git', args, { cwd: source, env, encoding: 'utf8' })
  assert.equal(git(['init']).status, 0)
  await writeFile(join(source, '.gitignore'), '.env\n.dsh/\nnode_modules/\nlib/\n')
  await writeFile(join(source, 'tracked.js'), 'export default 1\n')
  assert.equal(git(['add', '.gitignore', 'tracked.js']).status, 0)
  await writeFile(join(source, 'untracked source.js'), 'export default 2\n')
  await writeFile(join(source, '.env'), 'TEST_SECRET=fixture-only\n')
  for (const name of ['.dsh', 'node_modules', 'lib']) {
    await mkdir(join(source, name))
    await writeFile(join(source, name, 'sentinel'), 'must not copy\n')
  }
  // Git's test hook exercises the real ownership check without chown/root.
  env.GIT_TEST_ASSUME_DIFFERENT_OWNER = '1'
  const denied = git(['ls-files'])
  assert.equal(denied.status, 128, denied.stderr)
  assert.match(denied.stderr, /detected dubious ownership/)
  const configBefore = await text(join(source, '.git/config'))
  const { directory } = await fresh(t, source, env)
  assert.deepEqual((await readdir(directory)).sort(), ['.gitignore', 'tracked.js', 'untracked source.js'])
  assert.equal(await text(join(directory, 'tracked.js')), 'export default 1\n')
  assert.equal(await text(join(directory, 'untracked source.js')), 'export default 2\n')
  assert.equal(await text(join(source, '.git/config')), configBefore)
  assert.deepEqual(await readdir(home), [], 'fixture must not write global Git config')
  const stillDenied = git(['ls-files'])
  assert.equal(stillDenied.status, 128, stillDenied.stderr)
  assert.match(stillDenied.stderr, /detected dubious ownership/)
})

test('fresh source fixture runs dependency-free checks with no pnpm executable or cache', async t => {
  const { root, directory } = await fresh(t)
  const emptyPath = join(root, 'empty-bin')
  const emptyHome = join(root, 'home')
  await mkdir(emptyPath)
  await mkdir(emptyHome)
  await assert.rejects(lstat(join(directory, 'node_modules')), { code: 'ENOENT' })
  const env = { PATH: emptyPath, HOME: emptyHome, DSH_HOME: join(emptyHome, '.dsh'), XDG_CACHE_HOME: join(emptyHome, '.cache') }
  const result = spawnSync(process.execPath, ['scripts/check.mjs'], { cwd: directory, env, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Checked 1 profile recipe\(s\) and 20 package reference\(s\)/)
  const preview = spawnSync(process.execPath, ['scripts/apply-profile.mjs', 'personal-web', '--dry-run'], { cwd: directory, env, encoding: 'utf8' })
  assert.equal(preview.status, 0, preview.stderr)
  assert.match(preview.stdout, /dsh-project-steward/)
  assert.deepEqual(await readdir(emptyHome), [], 'checks must not populate home/cache/profile')
  assert.deepEqual(await readdir(emptyPath), [])
  await assert.rejects(lstat(join(directory, 'node_modules')), { code: 'ENOENT' })
  // This proves dependency-free validation, NOT an offline install or that an
  // agent will obey prose. No executable setup/installer is shipped in v1.
})

test('fresh fixture exposes shared root and workspace dependency links without modifying targets', async t => {
  const { root, directory } = await fresh(t)
  const shared = join(root, 'other-checkout/node_modules')
  await mkdir(shared, { recursive: true })
  await writeFile(join(shared, 'sentinel'), 'Do not mutate another checkout.\n')
  for (const dependencyDirectory of [join(directory, 'node_modules'), join(directory, 'packages/dsh-project-steward/node_modules')]) {
    await symlink(shared, dependencyDirectory, 'dir')
    assert.equal((await lstat(dependencyDirectory)).isSymbolicLink(), true)
    assert.equal(await realpath(dependencyDirectory), shared)
  }
  const skill = await text(skillPath)
  assert.match(skill, /symlinked, shared with another checkout[\s\S]*?\*\*do not install there\*\*/)
  assert.match(skill, /Do not unlink, delete, relink, or mutate another checkout/)
  assert.equal(await text(join(shared, 'sentinel')), 'Do not mutate another checkout.\n')
  assert.deepEqual(await readdir(shared), ['sentinel'])
})

test('repo guidance tracks source pins, script prerequisites, CI distinction, and setup stops', async () => {
  const skill = await text(skillPath)
  const manifest = JSON.parse(await text(join(repo, 'package.json')))
  assert.ok(skill.includes(manifest.packageManager))
  assert.ok(skill.includes(manifest.engines.node))
  assert.equal(manifest.scripts.pretest, 'pnpm run build')
  assert.ok(manifest.scripts.test.includes('packages/dsh-project-steward/test/*.test.js'))
  assert.match(skill, /fresh checkout-owned offline frozen, scripts-disabled install was validated/)
  for (const phrase of ['command -v pnpm', '--offline --frozen-lockfile --ignore-scripts', 'do not fall back online automatically', 'cache completeness', 'Node.js 24.20.0', 'does not change CI']) {
    assert.ok(skill.toLowerCase().includes(phrase.toLowerCase()), `missing ${phrase}`)
  }
  assert.ok(!(await text(join(repo, 'README.md'))).includes('npx --yes pnpm@'))
  const agents = await text(join(repo, 'AGENTS.md'))
  assert.ok(agents.split('\n').length < 15)
  assert.match(agents, /Without a skill tool/)
  assert.match(agents, /\.agents\/skills\/repository-setup\/SKILL.md/)
  assert.ok(!skill.includes('{{'), 'repo-owned procedure must not retain template placeholders')
})

test('v1 templates explicitly distinguish placeholders and verification evidence', async () => {
  const names = (await readdir(templates)).sort()
  assert.deepEqual(names, ['AGENTS.md.template', 'repository-setup.SKILL.md.template'])
  for (const name of names) {
    const template = await text(join(templates, name))
    assert.match(template, /Draft template v1/)
    assert.match(template, /Replace or remove all placeholders/)
    assert.match(template, /\{\{[A-Z_]+\}\}/)
  }
  const setup = await text(join(templates, names[1]))
  for (const phrase of ['Unverified proposal', 'Verified definition only', 'Executed successfully', 'Not run', '--offline --frozen-lockfile --ignore-scripts']) assert.ok(setup.includes(phrase))
})
