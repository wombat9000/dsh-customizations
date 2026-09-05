import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../../', import.meta.url))
test('documented apply separator previews the portable recap bundle', () => {
  const result = spawnSync(process.execPath, ['scripts/apply-profile.mjs', '--', 'personal-web', '--dry-run'], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /@wombat9000\/dsh-session-recap/)
  assert.match(result.stdout, /packages\/dsh-session-recap/)
})
