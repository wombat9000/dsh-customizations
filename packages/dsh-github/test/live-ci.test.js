import assert from 'node:assert/strict'
import test from 'node:test'
import { createGitHubLiveCI } from '../dist/src/live-ci.js'
import { fakeSubprocess, json } from './fixtures.js'

const head = 'a'.repeat(40)
const remote = 'b'.repeat(40)
const checkout = {
  cwd: '/fixture/workspace',
  root: '/fixture/workspace',
  branch: 'feature',
  head,
  remotes: ['git@github.com:acme/repo.git'],
}
const signal = () => new AbortController().signal
const pull = (sha = head) => ({
  number: 12,
  state: 'open',
  head: { sha, ref: 'feature', repo: { full_name: 'acme/repo' } },
  base: { repo: { full_name: 'acme/repo' } },
})
function fixture({
  conclusion = 'success',
  status = 'completed',
  pulls = [pull()],
  defaultHead = remote,
  total = 1,
  returned = 1,
  wrongSha = false,
  contexts = [],
} = {}) {
  const calls = []
  const transport = async (request, options) => {
    calls.push({ request, options })
    const path = request.path
    let data
    if (path === '/repos/acme/repo') data = { full_name: 'acme/repo', default_branch: 'trunk' }
    else if (path === '/repos/acme/repo/commits/trunk') data = { sha: defaultHead }
    else if (path.includes('/pulls?')) data = pulls
    else if (path.includes('/check-runs?')) {
      const commit = path.split('/')[5]
      data = {
        total_count: total,
        check_runs: Array.from({ length: returned }, () => ({
          head_sha: wrongSha ? 'c'.repeat(40) : commit,
          status,
          conclusion,
        })),
      }
    } else if (path.includes('/status?'))
      data = { sha: path.split('/')[5], total_count: contexts.length, statuses: contexts }
    else throw new Error(`Unexpected fixture path ${path}`)
    return { exitCode: 0, stdout: JSON.stringify(data), stderr: '' }
  }
  return { calls, transport }
}

test('current OPEN PR and actual default branch checks bind separate immutable SHAs and links', async () => {
  const fx = fixture()
  const owner = createGitHubLiveCI({}, fx)
  const result = await owner.service.readCheckout(checkout, signal())
  assert.equal(result.error, null)
  assert.deepEqual(
    result.rows.map((row) => [row.label, row.sha, row.state]),
    [
      ['PR #12', head, 'success'],
      ['Default · trunk', remote, 'success'],
    ],
  )
  assert.equal(result.rows[0].url, 'https://github.com/acme/repo/pull/12/checks')
  assert.equal(result.rows[1].url, `https://github.com/acme/repo/commit/${remote}/checks`)
  assert.ok(
    fx.calls.every((call) => call.options.cwd === checkout.cwd && call.request.method === 'GET'),
  )
  assert.ok(fx.calls.some((call) => call.request.path.includes('state=open&head=acme%3Afeature')))
  owner.dispose()
})

test('default checkout deduplicates the PR row and same-commit checks deduplicate within a read', async () => {
  for (const local of [{ ...checkout, branch: 'trunk' }, checkout]) {
    const fx = fixture({ defaultHead: head, pulls: local.branch === 'trunk' ? [] : [pull()] })
    const owner = createGitHubLiveCI({}, fx)
    const result = await owner.service.readCheckout(local, signal())
    assert.equal(result.rows.length, local.branch === 'trunk' ? 1 : 2)
    assert.equal(fx.calls.filter((call) => call.request.path.includes('/check-runs?')).length, 1)
    assert.equal(
      fx.calls.filter((call) => call.request.path.includes('/pulls?')).length,
      local.branch === 'trunk' ? 0 : 1,
    )
    owner.dispose()
  }
})

test('PR/local SHA mismatch is explicit; detached and unborn checkouts do not guess a PR', async () => {
  for (const local of [
    { ...checkout, head: remote },
    { ...checkout, branch: null },
    { ...checkout, head: null },
  ]) {
    const fx = fixture()
    const owner = createGitHubLiveCI({}, fx)
    const result = await owner.service.readCheckout(local, signal())
    if (local.branch && local.head) assert.equal(result.rows[0].mismatch, true)
    else {
      assert.equal(result.rows[0].sha, null)
      assert.equal(fx.calls.filter((call) => call.request.path.includes('/pulls?')).length, 0)
    }
    owner.dispose()
  }
})

for (const [status, conclusion, expected] of [
  ['queued', null, 'pending'],
  ['in_progress', null, 'running'],
  ['completed', 'failure', 'failure'],
  ['completed', 'timed_out', 'failure'],
  ['completed', 'action_required', 'failure'],
  ['completed', 'cancelled', 'cancelled'],
  ['completed', 'skipped', 'skipped'],
  ['completed', 'neutral', 'neutral'],
  ['completed', 'stale', 'stale'],
  ['completed', null, 'unknown'],
])
  test(`preserves CI state ${status}/${conclusion}`, async () => {
    const owner = createGitHubLiveCI({}, fixture({ status, conclusion }))
    const result = await owner.service.readCheckout(checkout, signal())
    assert.equal(result.rows[0].state, expected)
    owner.dispose()
  })

test('commit statuses contribute pending, failure, error and success independently of check runs', async () => {
  for (const state of ['pending', 'failure', 'error', 'success']) {
    const owner = createGitHubLiveCI({}, fixture({ total: 0, returned: 0, contexts: [{ state }] }))
    const result = await owner.service.readCheckout(checkout, signal())
    assert.equal(result.rows[0].state, state === 'error' ? 'failure' : state)
    assert.equal(result.rows[0].count, 1)
    owner.dispose()
  }
})

test('non-string status and check-run states cannot become valid CI conclusions', async () => {
  for (const config of [
    ...['failure', 'error', 'pending', 'success'].map((state) => ({
      total: 0,
      returned: 0,
      contexts: [{ state: [state] }],
    })),
    { status: ['completed'], conclusion: 'success' },
    { status: ['in_progress'], conclusion: null },
  ]) {
    const owner = createGitHubLiveCI({}, fixture(config))
    const result = await owner.service.readCheckout(checkout, signal())
    assert.match(result.error ?? '', /INVALID_RESPONSE/)
    assert.ok(result.rows.every((row) => row.state === 'unknown' && row.complete === false))
    owner.dispose()
  }
})

test('bounded concurrency rejects a third checkout without dispatch and cancels abandoned reads', async () => {
  const calls = []
  const owner = createGitHubLiveCI(
    {},
    {
      transport: (_, options) =>
        new Promise((resolve) => {
          calls.push(options)
          options.signal.addEventListener(
            'abort',
            () => resolve({ exitCode: 1, stdout: '', stderr: '' }),
            { once: true },
          )
        }),
    },
  )
  const controllers = [new AbortController(), new AbortController()]
  const pending = controllers.map((controller, index) =>
    owner.service.readCheckout({ ...checkout, root: `/fixture/${index}` }, controller.signal),
  )
  const busy = await owner.service.readCheckout({ ...checkout, root: '/fixture/third' }, signal())
  assert.equal(busy.error, 'CI busy')
  assert.equal(calls.length, 2)
  controllers.forEach((controller) => controller.abort())
  for (const read of pending) await assert.rejects(read, { code: 'CANCELLED' })
  assert.ok(calls.every((options) => options.signal.aborted))
  owner.dispose()
})

test('no checks, partial pagination, and wrong commit never report success', async () => {
  for (const config of [
    { total: 0, returned: 0 },
    { total: 201, returned: 100 },
    { total: 1, returned: 0 },
    { wrongSha: true },
  ]) {
    const fx = fixture(config)
    const owner = createGitHubLiveCI({}, fx)
    const result = await owner.service.readCheckout(checkout, signal())
    if (config.wrongSha) assert.match(result.error, /INVALID_RESPONSE/)
    else assert.notEqual(result.rows[0].state, 'success')
    assert.ok(fx.calls.length <= 12)
    owner.dispose()
  }
})

test('non-GitHub and ambiguous remotes make no request; absent/ambiguous PRs stay unknown', async () => {
  for (const remotes of [
    ['https://example.com/acme/repo.git'],
    [...checkout.remotes, 'git@github.com:acme/other.git'],
    [...checkout.remotes, 'https://example.com/acme/repo.git?token=secret'],
    ['https://github.com.evil.test/acme/repo.git'],
    ['https://github.com/acme/repo.git?token=secret'],
  ]) {
    const fx = fixture()
    const owner = createGitHubLiveCI({}, fx)
    const result = await owner.service.readCheckout({ ...checkout, remotes }, signal())
    assert.equal(fx.calls.length, 0)
    assert.equal(result.rows[0].sha, null)
    assert.doesNotMatch(JSON.stringify(result), /secret|evil\.test|example\.com/)
    owner.dispose()
  }
  for (const pulls of [
    [],
    [pull(), pull()],
    [{ ...pull(), state: 'closed' }],
    [{ ...pull(), head: { ...pull().head, ref: 'other' } }],
  ]) {
    const owner = createGitHubLiveCI({}, fixture({ pulls }))
    const result = await owner.service.readCheckout(checkout, signal())
    assert.equal(result.rows[0].state, 'unknown')
    assert.equal(result.rows[0].sha, null)
    owner.dispose()
  }
})

test('controlled clock enforces cadence, caches completed commits, and backs off stale failures', async () => {
  let clock = 1000
  let failed = false
  const fx = fixture()
  const owner = createGitHubLiveCI(
    {},
    {
      now: () => clock,
      transport: (...args) =>
        failed
          ? Promise.resolve({ exitCode: 1, stdout: '', stderr: 'HTTP 429 rate limit' })
          : fx.transport(...args),
    },
  )
  const initial = await owner.service.readCheckout(checkout, signal())
  assert.equal(initial.refreshAfterMs, 60000)
  const calls = fx.calls.length
  clock += 59000
  const cached = await owner.service.readCheckout(checkout, signal())
  assert.equal(cached.checkedAt, initial.checkedAt)
  assert.equal(cached.refreshAfterMs, 15000)
  assert.equal(cached.freshUntil, initial.checkedAt + 60000)
  assert.equal(fx.calls.length, calls)
  const unpushed = await owner.service.readCheckout({ ...checkout, head: 'c'.repeat(40) }, signal())
  assert.equal(unpushed.rows[0].mismatch, true)
  assert.equal(fx.calls.length, calls)
  clock += 1000
  failed = true
  const stale = await owner.service.readCheckout(checkout, signal())
  assert.equal(stale.stale, true)
  assert.equal(stale.checkedAt, 1000)
  assert.match(stale.error, /RATE_LIMITED/)
  assert.equal(stale.refreshAfterMs, 120000)
  clock += 120000
  assert.equal((await owner.service.readCheckout(checkout, signal())).refreshAfterMs, 240000)
  owner.dispose()
})

test('concurrent consumers deduplicate, cancel only their own wait, and disposal rejects late results', async () => {
  let release
  let transportSignal
  let calls = 0
  const fx = fixture()
  const owner = createGitHubLiveCI(
    {},
    {
      transport: async (...args) => {
        calls++
        if (calls === 1) {
          transportSignal = args[1].signal
          await new Promise((resolve) => {
            release = resolve
          })
        }
        return fx.transport(...args)
      },
    },
  )
  const controller = new AbortController()
  const first = owner.service.readCheckout(checkout, controller.signal)
  const second = owner.service.readCheckout(checkout, signal())
  controller.abort()
  await assert.rejects(first, { code: 'CANCELLED' })
  assert.equal(transportSignal.aborted, false)
  assert.equal(calls, 1)
  owner.dispose()
  assert.equal(transportSignal.aborted, true)
  release()
  await assert.rejects(second, { code: 'CANCELLED' })
  await assert.rejects(owner.service.readCheckout(checkout, signal()), { code: 'CANCELLED' })
})

test('per-row API failure retains the other verified row and backs off without inventing success', async () => {
  for (const [failingPath, failedIndex] of [
    ['/pulls?', 0],
    [`/commits/${head}/status?`, 0],
    [`/commits/${remote}/status?`, 1],
  ]) {
    let clock = 1000
    const fx = fixture()
    let requests = 0
    const owner = createGitHubLiveCI(
      {},
      {
        now: () => clock,
        transport: (...args) => {
          requests++
          return args[0].path.includes(failingPath)
            ? Promise.resolve({ exitCode: 1, stdout: '', stderr: 'HTTP 429 rate limit ghp_secret' })
            : fx.transport(...args)
        },
      },
    )
    const result = await owner.service.readCheckout(checkout, signal())
    assert.equal(result.rows.length, 2)
    assert.equal(result.rows[failedIndex].state, 'unknown')
    assert.equal(result.rows[failedIndex].complete, false)
    assert.match(result.rows[failedIndex].warning, /RATE_LIMITED/)
    const verified = result.rows[1 - failedIndex]
    assert.equal(verified.sha, failedIndex === 0 ? remote : head)
    assert.equal(verified.state, 'success')
    assert.equal(verified.complete, true)
    assert.equal(result.checkedAt, clock)
    assert.match(result.error, /RATE_LIMITED/)
    assert.equal(result.refreshAfterMs, 120000)
    assert.doesNotMatch(JSON.stringify(result), /ghp_secret/)
    const calls = requests
    clock += 119000
    const cached = await owner.service.readCheckout(checkout, signal())
    assert.equal(cached.checkedAt, 1000)
    assert.equal(requests, calls)
    clock += 1000
    assert.equal((await owner.service.readCheckout(checkout, signal())).refreshAfterMs, 240000)
    owner.dispose()
  }
})

test('malformed checkout input never dispatches or exposes its remote token', async () => {
  const fx = fixture()
  const owner = createGitHubLiveCI({}, fx)
  for (const input of [
    { ...checkout, cwd: 123 },
    { ...checkout, root: {} },
    { ...checkout, head: 'ghp_secret' },
    { ...checkout, branch: 'feature\nsecret' },
    { ...checkout, remotes: [null] },
  ]) {
    await assert.rejects(owner.service.readCheckout(input, signal()), (error) => {
      assert.equal(error.code, 'INVALID_RESPONSE')
      assert.doesNotMatch(error.message, /secret/)
      return true
    })
  }
  assert.equal(fx.calls.length, 0)
  owner.dispose()
})

test('managed gh backend preserves auth classification and bounded cancellation boundary', async () => {
  const subprocess = fakeSubprocess([
    json({ full_name: 'acme/repo', default_branch: 'trunk' }),
    { exitCode: 1, stdout: '', stderr: 'HTTP 401 bad credentials ghp_secret' },
  ])
  const owner = createGitHubLiveCI(subprocess)
  const result = await owner.service.readCheckout(checkout, signal())
  assert.match(result.error, /AUTH_REQUIRED/)
  assert.doesNotMatch(JSON.stringify(result), /ghp_secret/)
  assert.ok(
    subprocess.specs.every((spec) => spec.cwd === checkout.cwd && spec.argv.includes('GET')),
  )
  owner.dispose()
})
