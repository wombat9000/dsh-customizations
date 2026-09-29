import assert from 'node:assert/strict'
import { test } from 'node:test'
import { collectFiles } from '../dist/src/files.js'
import { LIMITS } from '../dist/src/contracts.js'

// This fake is a remote execution world: opaque keys are deliberately not paths.
function remote(input, hooks = {}) {
  const nodes = new Map([['.', { type: 'directory', version: 'v1' }]])
  for (const [path, value] of Object.entries(input)) {
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++)
      nodes.set(parts.slice(0, i).join('/'), { type: 'directory', version: 'v1' })
    nodes.set(
      path,
      typeof value === 'string' || value instanceof Uint8Array
        ? { type: 'file', content: value, version: 'v1' }
        : { version: 'v1', ...value },
    )
  }
  const targets = new Map(
    [...nodes.keys()].map((p, i) => [
      p,
      { targetKey: `opaque#${i * 71}`, displayPath: 'remote://not-a-host-path' },
    ]),
  )
  const calls = []
  const target = (path) => targets.get(nodes.get(path)?.alias ?? path)
  const lookup = (t) => [...targets].find(([, value]) => value.targetKey === t.targetKey)?.[0]
  const bytes = (n) =>
    typeof n.content === 'string'
      ? new TextEncoder().encode(n.content)
      : (n.content ?? new Uint8Array())
  const info = (n) =>
    n && {
      type: n.type,
      version: n.version,
      ...(n.type === 'file' ? { size: n.size ?? bytes(n).length } : {}),
    }
  const fs = {
    async resolve(path, opts) {
      calls.push(['resolve', path, opts.cwd])
      assert.equal(opts.cwd.startsWith('/remote/'), true)
      await hooks.resolve?.(path, nodes)
      if (!target(path)) throw new Error('private backend failure')
      return target(path)
    },
    contains(root, child) {
      return !hooks.outside?.has(child.targetKey)
    },
    async lstat(path, opts, signal) {
      calls.push(['lstat', path])
      signal?.throwIfAborted()
      return info(nodes.get(path))
    },
    async stat(t, signal) {
      calls.push(['stat', lookup(t)])
      signal?.throwIfAborted()
      return info(nodes.get(lookup(t)))
    },
    async listDir(t, signal) {
      const path = lookup(t)
      calls.push(['list', path])
      signal?.throwIfAborted()
      await hooks.list?.(path, nodes)
      const prefix = path === '.' ? '' : `${path}/`
      return [...nodes]
        .filter(([p]) => p !== '.' && p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
        .map(([p, n]) => ({
          name: p.slice(prefix.length),
          target: target(p),
          type: n.type === 'symlink' ? 'other' : n.type,
        }))
        .reverse()
    },
    async readBytes(t, signal, cap) {
      const path = lookup(t)
      calls.push(['read', path])
      signal.throwIfAborted()
      assert.equal(cap, LIMITS.fileBytes)
      await hooks.read?.(path, nodes)
      const data = bytes(nodes.get(path))
      if (data.length > cap)
        throw Object.assign(new Error('secret backend details'), { code: 'FS_TOO_LARGE' })
      return data
    },
  }
  return { fs, calls, nodes, targets }
}
const request = (pattern = '**/*.ts', maxFiles = LIMITS.maxFiles) => ({
  kind: 'files',
  pattern,
  question: 'Relevant?',
  maxFiles,
})
const single = (path) => ({
  kind: 'boolean',
  path,
  questions: [{ id: 'q', question: 'Relevant?' }],
})
const run = (
  fake,
  req = request(),
  signal = new AbortController().signal,
  cwd = '/remote/workspace',
) => collectFiles(fake.fs, cwd, req, signal)
const count = (result, reason) => result.skipped.find((s) => s.reason === reason)?.count ?? 0

test('remote opaque targets, deterministic glob order, hashes and immutable snapshots', async () => {
  const fake = remote({ 'z.ts': 'z', 'src/a.ts': 'a', 'src/b.js': 'b', 'a.ts': 'a' })
  const result = await run(fake)
  assert.deepEqual(
    result.files.map((f) => f.path),
    ['a.ts', 'src/a.ts', 'z.ts'],
  )
  assert.equal(
    result.files[0].sha256,
    'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',
  )
  assert.equal(result.complete, true)
  assert.ok(
    Object.isFrozen(result.files[0]) && Object.isFrozen(result.files) && Object.isFrozen(result),
  )
})

test('scoped patterns use *, ** and ? without traversing unrelated directories', async () => {
  const fake = remote({ 'src/a.ts': 'a', 'src/deep/b.ts': 'b', 'other/c.ts': 'c' })
  const result = await run(fake, request('src/?.ts'))
  assert.deepEqual(
    result.files.map((f) => f.path),
    ['src/a.ts'],
  )
  assert.deepEqual(
    fake.calls.filter((c) => c[0] === 'list').map((c) => c[1]),
    ['.', 'src'],
  )
})

test('invalid patterns and nonabsolute cwd fail before filesystem operations', async () => {
  for (const pattern of [
    '/a.ts',
    '../a.ts',
    'src/../a.ts',
    'a\\b',
    '{a,b}',
    '[ab]',
    '!foo',
    'a/**b',
    'a//b',
    './a',
    'C:/a',
  ]) {
    const fake = remote({})
    await assert.rejects(run(fake, request(pattern)), /Invalid/)
    assert.equal(fake.calls.length, 0)
  }
  await assert.rejects(run(remote({}), request(), undefined, 'relative'), /absolute/)
})

test('cwd is supplied independently on every call', async () => {
  const fake = remote({ 'a.ts': 'a' })
  await run(fake, single('a.ts'), undefined, '/remote/first')
  await run(fake, single('a.ts'), undefined, '/remote/second')
  assert.deepEqual(
    new Set(fake.calls.filter((c) => c[0] === 'resolve').map((c) => c[2])),
    new Set(['/remote/first', '/remote/second']),
  )
})

test('hidden, generated, sensitive data and binary filenames exclude before reads', async () => {
  const fake = remote({
    '.git/a.ts': 'a',
    '.dsh/a.ts': 'a',
    'node_modules/a.ts': 'a',
    'dist/a.ts': 'a',
    '.env': 'x',
    '.npmrc': 'x',
    '.ssh/key': 'x',
    '.aws/config': 'x',
    'credentials.json': '{}',
    'secrets.yaml': 'x',
    'key.pem': 'x',
    'package-lock.json': '{}',
    'data.db': 'x',
    'archive.zip': 'x',
    'credentials.ts': 'export const valid = true',
  })
  const result = await run(fake, request('**/*'))
  assert.deepEqual(
    result.files.map((f) => f.path),
    ['credentials.ts'],
  )
  assert.deepEqual(
    fake.calls.filter((c) => c[0] === 'read').map((c) => c[1]),
    ['credentials.ts'],
  )
  await assert.rejects(run(fake, single('credentials.json')), /excluded/)
  await assert.rejects(run(fake, single('.git/a.ts')), /excluded/)
})

test('symlinks, containment and directory cycles never read excluded targets', async () => {
  const fake = remote({
    'a.ts': 'a',
    'link.ts': { type: 'symlink', alias: 'a.ts' },
    loop: { type: 'directory', alias: '.' },
    'outside.ts': 'x',
  })
  const outside = fake.targets.get('outside.ts').targetKey
  fake.fs.contains = (_root, child) => child.targetKey !== outside
  const result = await run(fake, request('**/*'))
  assert.deepEqual(
    result.files.map((f) => f.path),
    ['a.ts'],
  )
  assert.equal(count(result, 'symlink'), 1)
  assert.equal(count(result, 'outside_workspace'), 1)
  assert.ok(count(result, 'excluded') >= 1)
  assert.equal(fake.calls.filter((c) => c[0] === 'list').length, 1)
  await assert.rejects(run(fake, single('link.ts')), /symlink/)
})

test('rejects non UTF8, binary, private keys, obvious secrets and oversized files', async () => {
  const fake = remote({
    'utf.ts': new Uint8Array([0xc3, 0x28]),
    'binary.ts': 'a\0b',
    'key.ts': '-----BEGIN RSA PRIVATE KEY-----',
    'token.ts': 'const api_key = "abcdefghijklmnopqrst"',
    'large.ts': 'x'.repeat(LIMITS.fileBytes + 1),
    'good.ts': 'const a = 1',
  })
  const result = await run(fake)
  assert.deepEqual(
    result.files.map((f) => f.path),
    ['good.ts'],
  )
  assert.equal(count(result, 'not_text'), 2)
  assert.equal(count(result, 'sensitive_content'), 2)
  assert.equal(count(result, 'too_large'), 1)
  assert.ok(!fake.calls.some((c) => c[0] === 'read' && c[1] === 'large.ts'))
})

test('accepts complete 10,000-line files and enforces the new UTF8 byte boundary', async () => {
  const large = 'void 0;\n'.repeat(10_000)
  assert.ok(Buffer.byteLength(large) > 65_536)
  const accepted = await run(remote({ 'large.ts': large }), single('large.ts'))
  assert.equal(accepted.files[0].content, large)
  assert.equal(accepted.complete, true)
  const boundary = '界'.repeat(LIMITS.fileBytes / 3)
  const exact = await run(remote({ 'boundary.ts': boundary }), single('boundary.ts'))
  assert.equal(exact.files[0].bytes, LIMITS.fileBytes)
  assert.equal(exact.files[0].content, boundary)
  const oversized = remote({ 'boundary.ts': boundary + 'x' })
  await assert.rejects(run(oversized, single('boundary.ts')), /too_large/)
  assert.ok(!oversized.calls.some(([operation]) => operation === 'read'))
})

test('file and aggregate byte budgets count skipped candidates without truncating', async () => {
  const input = Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [
      `a${String(i).padStart(2, '0')}.ts`,
      'x'.repeat(LIMITS.fileBytes),
    ]),
  )
  const result = await run(remote(input))
  assert.equal(result.files.length, LIMITS.batchBytes / LIMITS.fileBytes)
  assert.equal(count(result, 'byte_limit'), 4)
  assert.equal(result.matchedFiles, 12)
  assert.equal(result.complete, false)
  const limited = await run(remote(input), request('**/*.ts', 2))
  assert.equal(limited.files.length, 2)
  assert.equal(count(limited, 'file_limit'), 10)
})

test('directory, depth, candidate and entry budgets report partial coverage', async () => {
  const dirs = remote(
    Object.fromEntries(
      Array.from({ length: LIMITS.directories + 4 }, (_, i) => [`d${i}/a.ts`, 'a']),
    ),
  )
  const result = await run(dirs)
  assert.equal(result.complete, false)
  assert.equal(dirs.calls.filter((c) => c[0] === 'list').length, LIMITS.directories)
  const deep = await run(remote({ [`${'d/'.repeat(LIMITS.depth + 1)}a.ts`]: 'a' }))
  assert.equal(deep.complete, false)
  const many = await run(
    remote(
      Object.fromEntries(
        Array.from({ length: LIMITS.candidates + 2 }, (_, i) => [`f${i}.ts`, 'a']),
      ),
    ),
  )
  assert.equal(many.matchedFiles, LIMITS.candidates)
  assert.equal(many.complete, false)
  const entries = await run(
    remote(
      Object.fromEntries(
        Array.from({ length: LIMITS.visitedEntries + 2 }, (_, i) => [`f${i}.png`, 'a']),
      ),
    ),
  )
  assert.equal(entries.visitedEntries, LIMITS.visitedEntries)
  assert.equal(entries.complete, false)
})

test('cancellation stops promptly with no subsequent reads', async () => {
  const controller = new AbortController()
  const fake = remote(
    { 'a.ts': 'a', 'b.ts': 'b' },
    {
      read() {
        controller.abort('private cancellation details')
      },
    },
  )
  await assert.rejects(run(fake, request(), controller.signal), /cancelled/)
  assert.equal(fake.calls.filter((c) => c[0] === 'read').length, 1)
  const aborted = new AbortController()
  aborted.abort()
  const untouched = remote({})
  await assert.rejects(run(untouched, request(), aborted.signal), /cancelled/)
  assert.equal(untouched.calls.length, 0)
})

test('ancestor symlinks and unsafe directories are rejected before listing or reading', async () => {
  const fake = remote({ 'src/a.ts': 'a', 'safe/a.ts': 'a' })
  fake.nodes.get('src').type = 'symlink'
  fake.nodes.get('src').alias = 'safe'
  await assert.rejects(run(fake, single('src/a.ts')), /symlink/)
  assert.equal(fake.calls.filter((c) => c[0] === 'read').length, 0)
  const outside = remote({ 'src/a.ts': 'a' })
  const key = outside.targets.get('src').targetKey
  outside.fs.contains = (_root, child) => child.targetKey !== key
  const result = await run(outside)
  assert.equal(count(result, 'outside_workspace'), 1)
  assert.equal(outside.calls.filter((c) => c[0] === 'list').length, 1)
  assert.equal(outside.calls.filter((c) => c[0] === 'read').length, 0)
})

test('backend oversize errors and directory changes fail closed', async () => {
  const fake = remote({ 'a.ts': 'x'.repeat(LIMITS.fileBytes + 1) })
  const stat = fake.fs.stat
  fake.fs.stat = async (...args) => {
    const info = await stat(...args)
    delete info.size
    return info
  }
  assert.equal(count(await run(fake), 'too_large'), 1)
  const changed = remote(
    { 'a.ts': 'a' },
    {
      list(path, nodes) {
        nodes.get(path).version = 'changed'
      },
    },
  )
  const result = await run(changed)
  assert.equal(result.complete, false)
  assert.equal(count(result, 'changed'), 1)
  assert.equal(changed.calls.filter((c) => c[0] === 'read').length, 0)
})

test('version or identity changes discard snapshots and sanitize backend failures', async () => {
  const changed = remote(
    { 'a.ts': 'a' },
    {
      read(_path, nodes) {
        nodes.get('a.ts').version = 'v2'
      },
    },
  )
  assert.equal(count(await run(changed), 'changed'), 1)
  const swapped = remote(
    { 'a.ts': 'a', 'b.ts': 'b' },
    {
      read(path, nodes) {
        if (path === 'a.ts') nodes.get('a.ts').alias = 'b.ts'
      },
    },
  )
  assert.equal(count(await run(swapped), 'changed'), 1)
  const failure = remote(
    { 'a.ts': 'secret content' },
    {
      read() {
        throw new Error('secret backend details')
      },
    },
  )
  await assert.rejects(
    run(failure, single('a.ts')),
    (error) => error.message.includes('unreadable') && !error.message.includes('secret'),
  )
  const unavailable = remote(
    {},
    {
      resolve() {
        throw new Error('private host path')
      },
    },
  )
  await assert.rejects(run(unavailable), /^Error: File Intuition workspace is unavailable\.$/)
})

test('wildcard characters in POSIX filenames do not suppress glob matches', async () => {
  const result = await run(
    remote({ '*x.ts': 'export const x = 1', '?x.ts': 'export const y = 2' }),
    request('*.ts'),
  )
  assert.deepEqual(
    result.files.map((file) => file.path),
    ['*x.ts', '?x.ts'],
  )
  assert.equal(result.complete, true)
})

test('ancestor changes during a file read make discovery incomplete', async () => {
  const fixture = remote(
    { 'a.ts': 'export const a = 1' },
    {
      read(_path, nodes) {
        nodes.set('b.ts', { type: 'file', content: 'new file', version: 'v1' })
        nodes.get('.').version = 'v2'
      },
    },
  )
  const result = await run(fixture, request('*.ts'))
  assert.equal(count(result, 'changed'), 1)
  assert.equal(result.complete, false)
  assert.equal(result.files.length, 0)
})
