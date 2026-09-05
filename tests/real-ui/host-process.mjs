import { spawn } from 'node:child_process'

const closed = new WeakSet()

export function killGroup(child, signal) {
  if (!child?.pid) return
  try { process.kill(-child.pid, signal) } catch (error) { if (error.code !== 'ESRCH') throw error }
}

export async function stopHost(child, graceMs = 6000) {
  if (!child?.pid) return
  // The leader may already have exited while its descendants still hold resources.
  killGroup(child, 'SIGTERM')
  if (!closed.has(child)) {
    await new Promise((done) => {
      const complete = () => { clearTimeout(timer); child.removeListener('close', complete); done() }
      const timer = setTimeout(complete, graceMs)
      child.once('close', complete)
    })
  }
  // Always retract the whole group, including descendants of an exited leader.
  killGroup(child, 'SIGKILL')
  if (!closed.has(child)) {
    await new Promise((done) => {
      const complete = () => { clearTimeout(timer); child.removeListener('close', complete); done() }
      const timer = setTimeout(complete, 2000)
      child.once('close', complete)
    })
  }
}

export function startHost(command, args, options, timeoutMs = 60000) {
  const child = spawn(command, args, { ...options, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  child.once('close', () => closed.add(child))
  const ready = new Promise((accept, reject) => {
    let output = ''
    let settled = false
    const finish = (error, url) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.removeListener('error', failed)
      child.removeListener('exit', exited)
      child.stdout.removeListener('data', capture)
      child.stderr.removeListener('data', capture)
      // Drain runtime diagnostics without printing launch tokens or test state.
      child.stdout.resume()
      child.stderr.resume()
      if (error) reject(error); else accept(url)
    }
    const failed = () => finish(new Error('Disposable DSH could not start its process'))
    const exited = (code) => finish(new Error(`Disposable DSH exited (${code}). ${output.replace(/http:\/\/\S+/g, '[redacted URL]').slice(-6000)}`))
    const capture = (chunk) => {
      output = (output + String(chunk)).slice(-32000)
      const match = output.match(/(?:^|\n)dsh web: (http:\/\/127\.0\.0\.1:\d+[^\s]*)(?:[^\n]*)\n/)
      if (match) finish(null, match[1])
    }
    const timer = setTimeout(() => finish(new Error('Disposable DSH startup timed out')), timeoutMs)
    child.once('error', failed)
    child.once('exit', exited)
    child.stdout.on('data', capture)
    child.stderr.on('data', capture)
  })
  return { child, ready }
}
