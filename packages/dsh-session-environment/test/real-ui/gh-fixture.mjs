#!/usr/bin/env node
// Disposable-host gh replacement: fixed read descriptors only, no network,
// credentials, subprocesses, writes, or fallback to the user's executable.
const current = 'a'.repeat(40)
const main = 'b'.repeat(40)
const args = process.argv.slice(2)
const path = args[1]
const valid = args[0] === 'api' && args.includes('GET') && args.includes('github.com')
let data
if (valid && path === '/repos/ci-fixture/repo')
  data = { full_name: 'ci-fixture/repo', default_branch: 'trunk' }
else if (valid && path === '/repos/ci-fixture/repo/commits/trunk') data = { sha: main }
else if (
  valid &&
  path ===
    '/repos/ci-fixture/repo/pulls?state=open&head=ci-fixture%3Afeature%2Flive-ci&per_page=100&page=1'
)
  data = [
    {
      number: 42,
      state: 'open',
      head: { ref: 'feature/live-ci', sha: current, repo: { full_name: 'ci-fixture/repo' } },
      base: { repo: { full_name: 'ci-fixture/repo' } },
    },
  ]
else if (
  valid &&
  [current, main].some(
    (sha) =>
      path === `/repos/ci-fixture/repo/commits/${sha}/check-runs?per_page=100&page=1&filter=latest`,
  )
) {
  const sha = path.split('/')[5]
  const checks =
    sha === current
      ? [
          { name: 'Lint', status: 'completed', conclusion: 'success' },
          { name: 'Tests', status: 'in_progress', conclusion: null },
          { name: 'Build', status: 'queued', conclusion: null },
        ]
      : ['Lint', 'Typecheck', 'Tests', 'Build', 'Deploy'].map((name) => ({
          name,
          status: 'completed',
          conclusion: 'success',
        }))
  data = {
    total_count: checks.length,
    check_runs: checks.map((check) => ({ head_sha: sha, ...check })),
  }
} else if (
  valid &&
  [current, main].some(
    (sha) => path === `/repos/ci-fixture/repo/commits/${sha}/status?per_page=100&page=1`,
  )
)
  data = { sha: path.split('/')[5], total_count: 0, statuses: [] }
else {
  process.stderr.write('Fixture gh: authentication unavailable for this descriptor\n')
  process.exit(1)
}
process.stdout.write(JSON.stringify(data))
