import { createRequire } from 'node:module'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const cli = createRequire(require.resolve('@deepseek-ai/dsh/package.json'))
export const installed = (name) => import(pathToFileURL(cli.resolve(name)).href)
const { boot, initProfile, readProfilePatches } = await installed('@deepseek-ai/dsh-app-boot')
const { default: ConfigEditor } = await installed('@deepseek-ai/dsh-config-editor')
const { default: Settings } = await installed('@deepseek-ai/dsh-settings')

// Real profile persistence, Settings projection, Loader references and lifetimes.
// Callers supply only external service boundaries (credentials, RPC, HTTP).
export async function profileFixture(t, { rows, builtins, setup = () => {} }) {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'local-plugin-config-')))
  const dir = join(home, 'profiles', 'test')
  initProfile(dir, ['test-bundle'])
  const bundle = join(dir, 'node_modules', 'test-bundle')
  await mkdir(bundle, { recursive: true })
  await writeFile(join(home, 'package.json'), '{"name":"test-installation"}\n')
  await writeFile(
    join(bundle, 'package.json'),
    JSON.stringify({
      name: 'test-bundle',
      version: '1.0.0',
      dsh: { bundle: { patch: 'cordis.patch.yml' } },
    }),
  )
  await writeFile(
    join(bundle, 'cordis.patch.yml'),
    JSON.stringify([
      {
        insert: [
          { id: 'config-editor', name: 'cordis:editor' },
          { id: 'settings', name: 'cordis:settings' },
          ...rows,
        ],
      },
    ]),
  )
  await writeFile(join(dir, 'cordis.yml'), '[]\n')
  const profile = {
    name: 'test',
    startedBundles: ['test-bundle'],
    dir,
    patchPath: join(dir, 'cordis.patch.yml'),
    installAnchor: join(home, 'package.json'),
    cwd: home,
    home,
    overlays: [],
    telemetryDisabledEnv: undefined,
  }
  const contexts = []
  t.after(async () => {
    for (const ctx of contexts.reverse()) await ctx.fiber.dispose()
    await rm(home, { recursive: true, force: true })
  })
  const start = async () => {
    const ctx = await boot(
      'dsh',
      join(dir, 'cordis.yml'),
      readProfilePatches('dsh', profile),
      (ctx) => {
        ctx.provide('profileContext', profile)
        ctx.provide('appReady', {
          onReady(listener) {
            listener()
            return () => {}
          },
        })
        Object.assign(ctx.loader.builtins, {
          editor: ConfigEditor,
          settings: Settings,
          ...builtins,
        })
        setup(ctx)
      },
    )
    contexts.push(ctx)
    await ctx.loader.await()
    return ctx
  }
  return { ctx: await start(), profile, start }
}
