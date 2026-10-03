import assert from 'node:assert/strict'
import test from 'node:test'
import { checkoutIdentity, readSessionCI, CI_CHECKOUT_COMMAND } from '../lib/types/ci-host.js'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const head = 'a'.repeat(40)
const output = (branch = 'feature', sha = head, remote = 'git@github.com:acme/repo.git') =>
  `/fixture/repo\n__DSH_CI_HEAD__\n${sha}\n__DSH_CI_BRANCH__\n${branch}\n__DSH_CI_REMOTES__\norigin\t${remote} (fetch)\norigin\t${remote} (push)\n`
const snapshot = {
  rows: [],
  error: null,
  stale: false,
  checkedAt: 1,
  freshUntil: 25001,
  refreshAfterMs: 25000,
}
function fixture() {
  let text = output()
  let session = { header: { cwd: '/fixture/repo/nested' } }
  let calls = 0
  let read = async () => snapshot
  const host = {
    sessions: { get: () => session },
    async probe(cwd, signal) {
      assert.equal(cwd, session.header.cwd)
      assert.equal(signal.aborted, false)
      return text
    },
    github: () => ({
      readCheckout: async (checkout, signal) => {
        calls++
        assert.equal(checkout.cwd, session.header.cwd)
        return read(checkout, signal)
      },
    }),
  }
  return {
    host,
    request: { sessionId: 'session', checkoutKey: checkoutIdentity(session.header.cwd, text).key },
    setText: (next) => {
      text = next
    },
    setSession: (next) => {
      session = next
    },
    setRead: (next) => {
      read = next
    },
    calls: () => calls,
  }
}

test('optional GitHub absence leaves a bounded unavailable CI response', async () => {
  const fx = fixture()
  fx.host.github = () => undefined
  const result = await readSessionCI(fx.host, fx.request, new AbortController().signal)
  assert.equal(result.error, 'GitHub integration unavailable')
  assert.deepEqual(result.rows, [])
})

test('host rejects stale checkout keys before GitHub dispatch', async () => {
  for (const next of [
    output('other'),
    output('feature', 'b'.repeat(40)),
    output('feature', head, 'git@github.com:other/repo.git'),
  ]) {
    const fx = fixture()
    fx.setText(next)
    const result = await readSessionCI(fx.host, fx.request, new AbortController().signal)
    assert.match(result.error, /Checkout changed/)
    assert.equal(fx.calls(), 0)
  }
})

test('host discards late CI after branch, repo, cwd, session replacement, or cancellation', async () => {
  for (const change of ['branch', 'repo', 'cwd', 'session', 'cancel']) {
    const fx = fixture()
    let finish
    const controller = new AbortController()
    fx.setRead(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const pending = readSessionCI(fx.host, fx.request, controller.signal)
    await Promise.resolve()
    await Promise.resolve()
    assert.equal(fx.calls(), 1)
    if (change === 'branch') fx.setText(output('other'))
    if (change === 'repo') fx.setText(output('feature', head, 'git@github.com:other/repo.git'))
    if (change === 'cwd') fx.host.sessions.get().header.cwd = '/another'
    if (change === 'session') fx.setSession({ header: { cwd: '/fixture/repo/nested' } })
    if (change === 'cancel') controller.abort()
    finish(snapshot)
    const result = await pending
    assert.deepEqual(result.rows, [])
    assert.match(result.error, /changed|cancelled/)
  }
})

test('identity exposes a digest only; remotes and credentials remain host-side', () => {
  const identity = checkoutIdentity(
    '/fixture/repo',
    output('feature', head, 'https://secret@github.com/acme/repo.git'),
  )
  assert.match(identity.key, /^[a-f0-9]{64}$/)
  assert.equal(identity.checkout.remotes.length, 1)
  assert.doesNotMatch(identity.key, /secret/)
  assert.equal(checkoutIdentity('/fixture/repo', 'invalid or truncated output'), null)
})

test('real local shell probe reads a nested checkout, named/unborn/detached branch without fetch', (t) => {
  // Task-owned worktree artifacts, not the user's cwd or a live repository.
  const parent = resolve('artifacts/browser/environment-live-ci')
  mkdirSync(parent, { recursive: true })
  const directory = mkdtempSync(`${parent}/shell-fixture-`)
  t.after(() => {
    assert.equal(resolve(directory), directory)
    assert.ok(directory.startsWith(`${parent}/shell-fixture-`))
    rmSync(directory, { recursive: true, force: true })
  })
  execFileSync('git', ['init', '-b', 'trunk', directory], { stdio: 'ignore' })
  const nested = resolve(directory, 'nested')
  mkdirSync(nested, { recursive: true })
  const git = (...args) => execFileSync('git', ['-C', directory, ...args], { stdio: 'pipe' })
  git('remote', 'add', 'origin', 'https://github.com/acme/repo.git')
  const probe = () =>
    checkoutIdentity(
      nested,
      execFileSync('bash', ['-c', CI_CHECKOUT_COMMAND], { cwd: nested, encoding: 'utf8' }),
    )
  assert.equal(probe().checkout.head, null)
  assert.equal(probe().checkout.branch, 'trunk')
  writeFileSync(resolve(directory, 'fixture.txt'), 'fixture\n')
  git('add', 'fixture.txt')
  git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '-m',
    'fixture',
  )
  const named = probe()
  assert.equal(named.checkout.root, directory)
  assert.equal(named.checkout.cwd, nested)
  assert.equal(named.checkout.branch, 'trunk')
  assert.match(named.checkout.head, /^[a-f0-9]{40}$/)
  git('checkout', '--detach')
  assert.equal(probe().checkout.branch, null)
  assert.equal(probe().checkout.head, named.checkout.head)
})
