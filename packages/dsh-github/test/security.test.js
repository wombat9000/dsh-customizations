import assert from 'node:assert/strict'
import test from 'node:test'
import { createGitHubRuntime, GitHubError, normalizeRemoteUrl, sanitize } from '../src/runtime.js'
import { fakeSubprocess, json, connection, exec } from './fixtures.js'

const noCalls = () => fakeSubprocess(() => assert.fail('invalid input must not execute a subprocess'))

test('explicit targets are required and discovery cannot establish an implicit selection', async () => {
  const subprocess = noCalls()
  const runtime = createGitHubRuntime(subprocess)
  for (const [method, args] of [
    ['listRepositories', {}], ['getRepository', {}], ['getRepository', { owner: 'acme' }],
    ['listProjects', {}], ['getProject', { owner: 'acme' }],
    ['listProjectItems', { owner: 'acme' }], ['listIssues', { owner: 'acme' }],
    ['searchIssues', { query: 'test' }], ['getIssue', { owner: 'acme', repo: 'example' }],
    ['getIssueComments', { owner: 'acme', repo: 'example' }],
  ]) await assert.rejects(runtime[method](args, exec), GitHubError, method)
  assert.equal(subprocess.specs.length, 0)
})

test('invalid owner, repository, identifier, cursor, and limit inputs fail before subprocess execution', async () => {
  const subprocess = noCalls()
  const runtime = createGitHubRuntime(subprocess)
  for (const owner of ['../acme', '-flag', 'acme/repo', 'acme; echo unsafe', 'https://github.com/acme', '@secret-file', 'acme\nother']) {
    await assert.rejects(runtime.getRepository({ owner, repo: 'example' }, exec), GitHubError, owner)
  }
  for (const repo of ['../example', 'a/b', 'example; echo unsafe', '@secret-file', 'a\nb']) {
    await assert.rejects(runtime.getRepository({ owner: 'acme', repo }, exec), GitHubError, repo)
  }
  for (const value of [0, -1, 1.5, '1', NaN, Infinity]) {
    await assert.rejects(runtime.getIssue({ owner: 'acme', repo: 'example', issueNumber: value }, exec), GitHubError)
    await assert.rejects(runtime.getProject({ owner: 'acme', projectNumber: value }, exec), GitHubError)
  }
  for (const limit of [0, -1, 51, 1.5, '20', NaN, Infinity]) {
    await assert.rejects(runtime.listRepositories({ owner: 'acme', limit }, exec), GitHubError)
  }
  for (const cursor of [1, {}, [], 'a\nb']) {
    await assert.rejects(runtime.listRepositories({ owner: 'acme', cursor }, exec), GitHubError)
  }
  assert.equal(subprocess.specs.length, 0)
})

test('search cannot override explicit owner/repository scope or select pull requests', async () => {
  const subprocess = noCalls()
  const runtime = createGitHubRuntime(subprocess)
  for (const query of [
    'repo:other/private secret', 'org:other secret', 'user:other secret', 'owner:other secret',
    'is:pr secret', 'type:pr secret', 'test OR repo:other/private', 'test OR secret',
    'REPO:other/private', '-repo:acme/example',
  ]) await assert.rejects(runtime.searchIssues({ owner: 'acme', repo: 'example', query }, exec), GitHubError, query)
  assert.equal(subprocess.specs.length, 0)
})

test('remote normalization omits embedded credentials and rejects unsafe protocols, hosts, and shell forms', () => {
  for (const remote of ['https://user:password@github.com/acme/example.git', 'https://ghp_supersecret@github.com/acme/example.git']) {
    const result = normalizeRemoteUrl(remote)
    if (result) {
      assert.equal(result.url, 'https://github.com/acme/example')
      assert.doesNotMatch(JSON.stringify(result), /password|ghp_supersecret/)
    }
  }
  for (const remote of [
    'https://github.com.evil.test/acme/example.git', 'https://evil.test/acme/example.git',
    'http://github.com/acme/example.git', 'file:///private/secret', 'ext::sh -c echo',
    'git://github.com/acme/example.git', 'ssh://git@evil.test/acme/example.git',
    'git@github.com:acme/example.git;echo unsafe', 'https://github.com/acme/example.git?token=secret',
    'https://github.com/acme/example.git#secret',
  ]) assert.equal(normalizeRemoteUrl(remote), null, remote)
})

test('untrusted @file strings use raw gh fields and never trigger typed-field file expansion', async () => {
  const subprocess = fakeSubprocess([json({ data: { repository: { issues: connection([]) } } })])
  await createGitHubRuntime(subprocess).listIssues({ owner: 'acme', repo: 'example', cursor: '@/private/token', labels: ['@/private/credentials', '$(touch injected); `echo unsafe`'] }, exec)
  const argv = subprocess.specs[0].argv
  for (let index = 0; index < argv.length; index++) {
    if (argv[index].includes('@/private/') || argv[index].includes('$(touch')) assert.equal(argv[index - 1], '--raw-field')
    if (argv[index] === '--field') assert.match(argv[index + 1], /^\w+=\d+$/)
  }
  assert.equal(subprocess.specs[0].stdio.stdin, 'ignore')
  assert.ok(!argv.includes('--input'))
})

test('unknown API/shell/mutation fields and ambiguous nested continuations are rejected', async () => {
  const subprocess = noCalls()
  const runtime = createGitHubRuntime(subprocess)
  for (const extra of [{ endpoint: '/user' }, { query: 'mutation { unsafe }' }, { method: 'DELETE' }, { hostname: 'evil.test' }, { argv: ['auth', 'token'] }]) {
    await assert.rejects(runtime.getRepository({ owner: 'acme', repo: 'example', ...extra }, exec), { code: 'INVALID_ARGUMENT' })
  }
  for (const extra of [{ fieldValuesCursor: 'cursor' }, { valueCursor: 'cursor' }, { itemId: 'PI_1', valueCursor: 'cursor', fieldValuesLimit: 2 }, { itemId: 'PI_1', cursor: 'cursor' }, { fieldValuesLimit: 21 }, { nestedLimit: 51 }]) {
    await assert.rejects(runtime.listProjectItems({ owner: 'acme', projectNumber: 7, ...extra }, exec), { code: 'INVALID_ARGUMENT' })
  }
  await assert.rejects(runtime.detectRepositories({}, {}), { code: 'WORKSPACE_REQUIRED' })
  assert.equal(subprocess.specs.length, 0)
})

test('sanitization strips known tokens, authorization headers, and credential URLs', () => {
  const secrets = ['ghp_abcdefghijklmnopqrstuvwxyz1234567890', 'github_pat_abcdefghijklmnopqrstuvwxyz_1234567890', 'fixture-bearer-token', 'fixture-password']
  const text = `\u001b[31mAuthorization: Bearer ${secrets[2]}\u001b[0m\n${secrets[0]} ${secrets[1]} https://user:${secrets[3]}@github.com/acme/example`
  const result = sanitize(text)
  for (const secret of secrets) assert.ok(!result.includes(secret), secret)
})
