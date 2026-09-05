import assert from 'node:assert/strict'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { startHost, stopHost } from './host-process.mjs'

const options = { env: { PATH: process.env.PATH } }
const launchUrl = 'http://127.0.0.1:12345/?token=fixture-secret'
const nodeHost = (source, timeout = 2000) => startHost(process.execPath, ['--input-type=module', '-e', source], options, timeout)

// These helpers use POSIX process groups, like the canonical Linux CI environment.
const posix = { skip: process.platform === 'win32', timeout: 10000 }

test('spawn failure rejects promptly and cleanup is safe', posix, async () => {
  const host = startHost('/nonexistent-dsh-test-launcher', [], options, 1000)
  await assert.rejects(host.ready, /could not start its process/)
  await stopHost(host.child, 50)
})

test('startup exit reports failure without exposing the launch token', posix, async () => {
  const host = nodeHost(`console.error(${JSON.stringify(`Failed request ${launchUrl}`)}); process.exit(3)`)
  try {
    await assert.rejects(host.ready, (error) => {
      assert.match(error.message, /exited \(3\)/)
      assert.match(error.message, /redacted URL/)
      assert.doesNotMatch(error.message, /fixture-secret|token=/)
      return true
    })
  } finally { await stopHost(host.child, 50) }
})

test('startup timeout rejects and the host is stopped', posix, async () => {
  const host = nodeHost('setInterval(() => {}, 1000)', 100)
  try { await assert.rejects(host.ready, /startup timed out/) }
  finally { await stopHost(host.child, 50) }
  assert.ok(host.child.exitCode !== null || host.child.signalCode !== null)
})

test('readiness waits for the complete startup URL across output chunks', posix, async () => {
  const host = nodeHost(`
    process.stdout.write('dsh web: http://127.0.0.1:12345/?token=fixture')
    setTimeout(() => process.stdout.write('-secret\\n'), 25)
    setInterval(() => {}, 1000)
  `)
  try { assert.equal(await host.ready, launchUrl) }
  finally { await stopHost(host.child, 50) }
})

test('ready host shuts down even when it ignores SIGTERM', posix, async () => {
  const host = nodeHost(`
    process.on('SIGTERM', () => {})
    console.log(${JSON.stringify(`dsh web: ${launchUrl}`)})
    setInterval(() => {}, 1000)
  `)
  try { assert.equal(await host.ready, launchUrl) }
  finally { await stopHost(host.child, 50) }
  assert.equal(host.child.signalCode, 'SIGKILL')
})

async function running(pid) {
  try {
    process.kill(pid, 0)
    // An orphan can briefly remain as a zombie until the container init reaps it.
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8')
    return stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3) !== 'Z'
  } catch (error) {
    if (error.code === 'ESRCH' || error.code === 'ENOENT') return false
    throw error
  }
}

test('cleanup stops descendants after the launcher has exited', { skip: process.platform !== 'linux', timeout: 10000 }, async () => {
  const descendant = `setInterval(() => {}, 1000); process.send('ready')`
  const host = nodeHost(`
    import { spawn } from 'node:child_process'
    const descendant = spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    })
    descendant.once('message', () => {
      console.log('descendant=' + descendant.pid)
      console.log(${JSON.stringify(`dsh web: ${launchUrl}`)})
      setTimeout(() => process.exit(0), 25)
    })
  `)
  let descendantPid
  let output = ''
  host.child.stdout.on('data', (chunk) => {
    output += String(chunk)
    const match = output.match(/descendant=(\d+)\n/)
    if (match) descendantPid = Number(match[1])
  })
  const exited = once(host.child, 'exit')
  try {
    await host.ready
    await exited
    assert.ok(descendantPid, 'fixture reports its descendant PID')
    assert.equal(await running(descendantPid), true)
    await stopHost(host.child, 50)
    const deadline = Date.now() + 2000
    while (await running(descendantPid) && Date.now() < deadline) await delay(20)
    assert.equal(await running(descendantPid), false)
  } finally {
    await stopHost(host.child, 50)
    if (descendantPid) {
      try { process.kill(descendantPid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
    }
  }
})
