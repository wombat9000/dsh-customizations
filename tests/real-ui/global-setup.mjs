import { mkdtemp, mkdir, writeFile, symlink, rm, copyFile, readFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { killGroup, startHost, stopHost } from './host-process.mjs'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '../..')
// Add UI bundles here; every spec shares this one host, not one host per package.
const plugins = [
  { name: '@wombat9000/dsh-session-recap', directory: 'packages/dsh-session-recap' },
  { name: '@local/dsh-worktree', directory: 'packages/dsh-worktree' },
]

export async function waitForFixture(workspace, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs
  do {
    try {
      const id = await readFile(join(workspace, '.visual-fixture-ready'), 'utf8')
      if (id !== 'visual-test-history') throw new Error('Unexpected visual fixture identity')
      return
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    await delay(25)
  } while (Date.now() < deadline)
  throw new Error('Disposable DSH session fixture did not persist and reopen successfully')
}

export default async function setup() {
  return startDisposableHost()
}

// Shared by Playwright and the browser-free migration smoke check. Keep all
// credential isolation, authentication and process cleanup in this one path.
export async function startDisposableHost({ additionalPlugins = [], profilePatch } = {}) {
  const bundles = [...plugins, ...additionalPlugins]
  const directory = await mkdtemp(join(tmpdir(), 'dsh-real-ui-'))
  const home = join(directory, 'home')
  const dshHome = join(directory, 'dsh')
  const workspace = join(directory, 'workspace')
  const profile = join(dshHome, 'profiles', 'visual-tests')
  let child
  let stopping
  const emergency = () => killGroup(child, 'SIGKILL')
  const interrupted = () => { void cleanup().finally(() => process.exit(130)) }
  const terminated = () => { void cleanup().finally(() => process.exit(143)) }
  const cleanup = () => stopping ??= (async () => {
    await stopHost(child)
    process.removeListener('exit', emergency)
    process.removeListener('SIGINT', interrupted)
    process.removeListener('SIGTERM', terminated)
    delete process.env.DSH_TEST_COOKIE
    delete process.env.DSH_TEST_URL
    delete process.env.DSH_TEST_WORKSPACE
    await rm(directory, { recursive: true, force: true })
  })()
  process.once('exit', emergency)
  process.once('SIGINT', interrupted)
  process.once('SIGTERM', terminated)
  try {
    for (const path of [home, workspace, profile]) await mkdir(path, { recursive: true })
    for (const plugin of bundles) {
      const target = join(profile, 'node_modules', plugin.name)
      await mkdir(dirname(target), { recursive: true })
      await symlink(join(root, plugin.directory), target, 'dir')
    }
    const fixture = join(profile, 'node_modules', 'dsh-visual-fixture')
    await mkdir(fixture, { recursive: true })
    await copyFile(join(root, 'tests/real-ui/session-fixture.mjs'), join(fixture, 'index.mjs'))
    await writeFile(join(fixture, 'package.json'), JSON.stringify({ name: 'dsh-visual-fixture', type: 'module', main: 'index.mjs', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
    await writeFile(join(fixture, 'cordis.patch.yml'), '- insert:\n    - id: visual-fixture\n      name: dsh-visual-fixture\n')
    await writeFile(join(profile, 'package.json'), JSON.stringify({
      name: 'dsh-visual-tests', private: true, type: 'module',
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', ...bundles.map((plugin) => plugin.name), 'dsh-visual-fixture'], patchReload: 'startup' } },
    }))
    if (profilePatch) await copyFile(profilePatch, join(profile, 'cordis.patch.yml'))
    const launcherManifest = require.resolve('@deepseek-ai/dsh/package.json')
    const installed = JSON.parse(await readFile(launcherManifest, 'utf8')).version
    const expected = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).devDependencies['@deepseek-ai/dsh']
    if (installed !== expected) throw new Error(`Disposable DSH version mismatch: expected ${expected}, installed ${installed}`)
    const cli = join(dirname(launcherManifest), 'lib/bin.js')
    // Never inherit provider credentials, DSH paths, proxy credentials, or shell init settings.
    const env = { PATH: process.env.PATH, HOME: home, USER: 'visual-test', LOGNAME: 'visual-test', LANG: 'en_US.UTF-8', TZ: 'UTC',
      XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), XDG_DATA_HOME: join(home, '.local/share'),
      DSH_HOME: dshHome, DSH_TELEMETRY_DISABLED: '1' }
    const host = startHost(process.execPath, [cli, '--profile', 'visual-tests', '--no-open', '--host', '127.0.0.1', '--port', '0'], { cwd: workspace, env })
    child = host.child
    const authenticatedUrl = await host.ready
    await waitForFixture(workspace)
    // Exchange the ephemeral launch token outside Playwright: no URL token in traces/errors.
    let response
    try { response = await fetch(authenticatedUrl, { redirect: 'manual', signal: AbortSignal.timeout(10000) }) }
    catch { throw new Error('Disposable DSH authentication exchange failed') }
    const cookie = response.headers.get('set-cookie')?.split(';', 1)[0]
    if (response.status !== 303 || !cookie) throw new Error('Disposable DSH did not issue its browser session cookie')
    const separator = cookie.indexOf('=')
    const url = new URL(authenticatedUrl)
    url.search = ''
    process.env.DSH_TEST_URL = url.href
    process.env.DSH_TEST_COOKIE = JSON.stringify({ name: cookie.slice(0, separator), value: cookie.slice(separator + 1), url: url.href, httpOnly: true, sameSite: 'Strict' })
    process.env.DSH_TEST_WORKSPACE = workspace
    console.log('Disposable DSH is ready (isolated home and workspace).')
    return cleanup
  } catch (error) {
    await cleanup()
    throw error
  }
}
