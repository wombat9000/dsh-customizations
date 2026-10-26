// Explicit opt-in real-stack check. Never part of ordinary CI: it requires
// preinstalled agent-browser/Chromium/ffmpeg. Serves only disposable local data.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, readFile, copyFile, mkdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { Context } from '@deepseek-ai/cordis'
import * as Tools from '@deepseek-ai/dsh-tools'
import * as Prompt from '@deepseek-ai/dsh-system-prompt'
import * as Recording from '../dist/src/index.js'

const cli = createRequire(createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json'))
const { default: Subprocess } = await import(
  pathToFileURL(cli.resolve('@deepseek-ai/dsh-subprocess-local')).href
)
const workspace = await mkdtemp(join(tmpdir(), 'dsh-recording-journey-'))
const server = createServer((_request, response) => {
  response.setHeader('content-type', 'text/html')
  response.end(`<!doctype html><html><meta charset="utf-8"><title>Browser recording fixture</title>
    <style>body{font:20px system-ui;background:#f6f7fb;padding:64px;color:#192334}button,input{font:inherit;padding:14px;border:1px solid #718096;border-radius:8px}button:hover{background:#d6e6ff}section{max-width:760px;padding:40px;background:white;border-radius:16px}#status{padding:20px 0;color:#215bb0}</style>
    <section><h1>DSH browser recording</h1><p>Isolated fixture — no account, provider or external write.</p><label>Name <input id="name" value="Before"></label><p><button id="neighbor">Neighbor control</button> <button id="save">Save fixture</button></p><p id="status" role="status">Ready</p><label>Secret <input id="secret" type="password"></label></section>
    <script>document.querySelector('#save').onclick=()=>document.querySelector('#status').textContent='Saved: '+document.querySelector('#name').value</script></html>`)
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const ctx = new Context()
const owner = { header: { cwd: workspace } }
try {
  for (const plugin of [Prompt, Tools, Subprocess])
    await ctx.plugin(plugin.default ?? plugin, {}).await()
  await ctx.plugin(Recording).await()
  const call = (name, args = {}) =>
    ctx
      .get('tools')
      .get(`browser_recording_${name}`)
      .execute(args, { agent: { session: owner }, signal: new AbortController().signal })
  const start = await call('start', { url: `http://127.0.0.1:${server.address().port}` })
  assert.match(start.snapshot, /Save fixture/)
  await call('action', { action: 'hover', target: '#neighbor' })
  await call('action', { action: 'hover', target: '#save' })
  await call('action', { action: 'fill', target: '#name', value: 'Recorded safely' })
  await call('action', { action: 'click', target: '#save' })
  assert.match((await call('action', { action: 'snapshot' })).output, /Saved: Recorded safely/)
  await assert.rejects(
    call('action', { action: 'fill', target: '#secret', value: 'must-not-appear' }),
    /Sensitive fields/,
  )
  // Reject redirected artifact storage without losing the stopped recording.
  await symlink(tmpdir(), join(workspace, '.dsh'))
  await assert.rejects(call('stop'), /Artifact directories must not be symlinks/)
  await rm(join(workspace, '.dsh'))
  const result = await call('stop')
  assert.ok(result.durationSeconds > 1 && result.durationSeconds <= 30)
  assert.equal(result.loopSkipped, false)
  const bytes = await readFile(result.loop)
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP')
  assert.ok(bytes.includes(Buffer.from('ANIM')))
  const probe = JSON.parse(
    execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'stream=codec_type,width,height', '-of', 'json', result.mp4],
      { encoding: 'utf8' },
    ),
  )
  assert.equal(probe.streams[0].codec_type, 'video')
  assert.equal(probe.streams[0].width, 2560)
  assert.equal(probe.streams[0].height, 1440)
  assert.equal(probe.streams.length, 1)
  const destination = process.env.DSH_RECORDING_EVIDENCE
  if (destination) {
    await mkdir(destination, { recursive: true })
    await copyFile(result.mp4, join(destination, 'browser-recording-demo.mp4'))
    await copyFile(result.loop, join(destination, 'browser-recording-demo.loop.webp'))
  }
  console.log(
    `Real DSH tools + managed subprocess + agent-browser + ffmpeg passed; ${result.durationSeconds.toFixed(1)}s, 2560×1440 MP4 and animated WebP; password field rejected`,
  )
} finally {
  await ctx.fiber.dispose()
  await new Promise((resolve) => server.close(resolve))
  await rm(workspace, { recursive: true, force: true })
}
