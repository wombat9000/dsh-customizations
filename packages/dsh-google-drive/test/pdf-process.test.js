import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pdfTools, pdfProcess, trustedPdfToolMode } from '../src/pdf-process.js'

let tools
try {
  tools = await pdfTools()
  await access('/usr/bin/python3')
  tools.probe = '/usr/bin/python3'
} catch { tools = undefined }
const native = { skip: !tools && 'Native PDF prerequisites and Python test probe unavailable' }

test('tool trust permits macOS administrator group but rejects other writable installs', () => {
  assert.equal(trustedPdfToolMode({ uid: 501, gid: 80, mode: 0o775 }, 'darwin', 501), true)
  assert.equal(trustedPdfToolMode({ uid: 501, gid: 20, mode: 0o775 }, 'darwin', 501), false)
  assert.equal(trustedPdfToolMode({ uid: 501, gid: 80, mode: 0o777 }, 'darwin', 501), false)
  assert.equal(trustedPdfToolMode({ uid: 501, gid: 80, mode: 0o775 }, 'linux', 501), false)
})

test('native runner enforces resource limits and removes inherited credentials', native, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pdf-runner-'))
  process.env.DSH_PDF_TEST_SECRET = 'must-not-reach-child'
  try {
    const result = await pdfProcess(tools, 'probe', ['-I', '-c', `import resource,os,json
print(json.dumps({"as":resource.getrlimit(resource.RLIMIT_AS),"cpu":resource.getrlimit(resource.RLIMIT_CPU),"fsize":resource.getrlimit(resource.RLIMIT_FSIZE),"nofile":resource.getrlimit(resource.RLIMIT_NOFILE),"core":resource.getrlimit(resource.RLIMIT_CORE),"secret":os.environ.get("DSH_PDF_TEST_SECRET"),"path":os.environ.get("PATH")}))`], { cwd: dir })
    const limits = JSON.parse(result)
    if (process.platform === 'linux') assert.deepEqual(limits.as, [536870912, 536870912])
    assert.deepEqual(limits.cpu, [30, 30])
    assert.deepEqual(limits.fsize, [33554432, 33554432])
    assert.deepEqual(limits.nofile, [64, 64])
    assert.deepEqual(limits.core, [0, 0])
    assert.equal(limits.secret, null)
    assert.equal(limits.path, null)
    if (process.platform === 'linux') {
      await assert.rejects(pdfProcess(tools, 'probe', ['-I', '-c', 'x=bytearray(700*1024*1024)'], { cwd: dir }), /processing limits/u)
    }
    await assert.rejects(pdfProcess(tools, 'probe', ['-I', '-c', 'open("large", "wb").write(b"x"*(34*1024*1024))'], { cwd: dir }), /processing limits/u)
  } finally { delete process.env.DSH_PDF_TEST_SECRET; await rm(dir, { recursive: true, force: true }) }
})

test('native runner bounds stdout/stderr, times out, and awaits cancellation close', native, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pdf-runner-'))
  try {
    await assert.rejects(pdfProcess(tools, 'probe', ['-I', '-c', 'print("x"*100000)'], { cwd: dir, limit: 32 }), /output limit/u)
    await assert.rejects(pdfProcess(tools, 'probe', ['-I', '-c', 'import sys;sys.stderr.write("private-path"*100000)'], { cwd: dir }), error => /diagnostic limit/u.test(error.message) && !error.message.includes('private-path'))
    await assert.rejects(pdfProcess(tools, 'probe', ['-I', '-c', 'import time;time.sleep(10)'], { cwd: dir, timeout: 40 }), /time limit/u)
    const controller = new AbortController()
    const promise = pdfProcess(tools, 'probe', ['-I', '-c', 'import os,signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);os.fork();time.sleep(10)'], { cwd: dir, signal: controller.signal })
    const timer = setTimeout(() => controller.abort(), 100)
    try { await assert.rejects(promise, /cancelled/u) } finally { clearTimeout(timer) }
  } finally { await rm(dir, { recursive: true, force: true }) }
})
