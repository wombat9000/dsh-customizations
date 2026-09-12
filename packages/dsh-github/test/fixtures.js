import assert from 'node:assert/strict'

// Managed subprocess fixtures only: never invoke Git, gh, a shell, or a network.
export function fakeSubprocess(runs = [], options = {}) {
  const specs = []
  const resolutions = []
  const subprocess = {
    specs,
    resolutions,
    async resolveExecutable(command, ...args) {
      resolutions.push({ command, args })
      assert.ok(['gh', 'git'].includes(command), `unexpected executable: ${command}`)
      if (options.resolveError) throw options.resolveError
      if (options.missing === command) return undefined
      return `/fixture/bin/${command}`
    },
    spawn(spec) {
      specs.push(spec)
      assert.ok(Array.isArray(spec.argv), 'use argv, not shell interpolation')
      assert.ok(['/fixture/bin/gh', '/fixture/bin/git'].includes(spec.argv[0]))
      const run = typeof runs === 'function' ? runs(spec, specs.length - 1) : runs.shift()
      assert.ok(run, `unexpected subprocess: ${JSON.stringify(spec.argv)}`)
      if (run.spawnError) throw run.spawnError
      const reader = (text = '', lossy = false) => ({
        readFrom: () => ({ text, nextOffset: Buffer.byteLength(text), lossy }),
      })
      return {
        pid: 123,
        collected: {
          stdout: reader(run.stdout ?? '', run.lossy === true),
          stderr: reader(run.stderr ?? '', run.stderrLossy === true),
        },
        done: run.pending ? new Promise(resolve => {
          const finish = () => resolve({ exitCode: null, signal: 'SIGTERM' })
          if (spec.signal.aborted) finish()
          else spec.signal.addEventListener('abort', finish, { once: true })
        }) : Promise.resolve({ exitCode: run.exitCode ?? 0, signal: run.signal ?? null }),
        terminate() {},
        waitForExit: async () => true,
      }
    },
  }
  return subprocess
}

export const json = value => ({ stdout: JSON.stringify(value) })
export const connection = (nodes = [], hasNextPage = false, endCursor = null) => ({
  nodes, totalCount: nodes.length, pageInfo: { hasNextPage, endCursor },
})
export const exec = { cwd: '/fixture/workspace' }
