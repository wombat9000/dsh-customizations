import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import test from 'node:test'

const skill = new URL('../.agents/skills/dsh-client-ui-development/SKILL.md', import.meta.url)
const source = await readFile(skill, 'utf8')

test('client UI guidance has discoverable skill metadata and an AGENTS entrypoint', async () => {
  const frontmatter = source.match(/^---\n([\s\S]*?)\n---\n/)
  assert.ok(frontmatter, 'skill has YAML frontmatter')
  assert.match(frontmatter[1], /^name: dsh-client-ui-development$/m)
  assert.match(frontmatter[1], /^description: \S.+$/m)
  const agents = await readFile(new URL('../AGENTS.md', import.meta.url), 'utf8')
  assert.ok(agents.includes('.agents/skills/dsh-client-ui-development/SKILL.md'))
})

test('all local skill references resolve to repository files', async () => {
  const links = [...source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1])
  assert.ok(links.length > 0, 'guidance links to reusable setup and fixtures')
  for (const link of links) {
    assert.ok(!/^[a-z]+:/i.test(link), `expected a local reference: ${link}`)
    const target = new URL(link.split('#')[0], skill)
    assert.ok((await stat(target)).isFile(), `missing referenced file: ${link}`)
  }
})

test('the decision table retains three distinct change paths', () => {
  const table = source.split('## Choose the smallest sufficient path\n')[1]?.split('\n## ')[0]
  assert.ok(table, 'decision table precedes the detailed procedure')
  const rows = table.split('\n').filter((line) => /^\| \*\*/.test(line))
  assert.equal(rows.length, 3)
  for (const label of ['Presentation only', 'Established behavior', 'Integration boundary']) {
    assert.ok(
      rows.some((row) => row.includes(`**${label}:**`)),
      `missing path: ${label}`,
    )
  }
  // These are document/discovery checks, not proof of agent behavior or UI correctness.
})
