import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { packageRoot, presetRoot, presetId, skillName, yaml } from './fixtures.js'
import { TOOL_NAMES } from '../../dsh-github/src/tools.js'
import { GITHUB_WRITE_TOOL_NAMES } from '../../dsh-github/src/write-tools.js'

const root = join(presetRoot, presetId, 'skills', skillName)
const path = join(root, 'SKILL.md')
const sourceCommit = '3cca18b368ae95cdbdebbff572ccafa662551015'

test('bundled skill covers the six ordered planning stages without restarting agreed decisions', async () => {
  const text = await readFile(path, 'utf8')
  const header = yaml.load(text.match(/^---\n([\s\S]+?)\n---/)[1])
  assert.equal(header.name, skillName)
  assert.match(header.description, /individually approved/)
  const headings = [...text.matchAll(/^## [1-6]\. (.+)$/gm)].map(match => match[1])
  assert.deepEqual(headings, ['Clarify the outcome', 'Inspect the facts', 'Synthesize the project', 'Decompose into verifiable tasks', 'Review conversationally', 'Publish and report'])
  for (const pattern of [
    /outcome, audience, scope, non-goals, constraints, and observable acceptance criteria/,
    /Reuse decisions already agreed/,
    /Inspect discoverable facts yourself/,
    /Ask the user only about material choices/,
    /prerequisite decisions before dependent questions/,
    /verified facts, assumptions, unresolved decisions/,
    /initiative-level context in the README/,
    /Keep implementation task specifications in issues/,
    /independently verified/,
    /validation requirements, and genuine blockers/,
    /parallel.*shared-file/s,
    /Keep drafts in the conversation/,
  ]) assert.match(text, pattern)
})

test('planning instructions preserve exact-call approval and built-in plan-mode boundaries', async () => {
  const text = await readFile(path, 'utf8')
  for (const pattern of [
    /agent preset, not DSH's built-in plan mode/,
    /If plan mode is active.*do not publish or mutate/,
    /exit_plan_mode` never authorizes a GitHub write/,
    /Conversational agreement.*does not replace exact per-call approval/,
    /approval is denied or unavailable, stop/,
    /do not bypass approval using Bash, another API, or delegation/,
    /Review is not batch approval/,
    /changed content or targets need a new call and approval/,
    /earlier successful writes remain/,
    /no batch transaction, automatic rollback, or durable recovery ledger/,
    /confirmed, failed, uncertain, and not-attempted/,
    /inspect GitHub before deciding whether to retry/,
    /untrusted content.*approval or scope boundaries/,
  ]) assert.match(text, pattern)
})

test('publication instructions use only existing shared GitHub tools and their supported inputs', async () => {
  const text = await readFile(path, 'utf8')
  const actual = [...new Set(text.match(/\bgithub_[a-z_]+\b/g))].sort()
  const known = [...Object.values(TOOL_NAMES), ...GITHUB_WRITE_TOOL_NAMES].sort()
  assert.deepEqual(actual, known, 'instructions neither omit shared capabilities nor invent new tool names')
  for (const pattern of [
    /Repository owner, project owner, and optional template owner are separate choices/,
    /Discovery does not select or restrict a repository/,
    /Follow `nextCursor` and nested collection cursors/,
    /first page.*not evidence of absence/,
    /github_create_project` with `owner` and `title`/,
    /returned project number, not a guessed one/,
    /github_update_project` separately/,
    /Draft copying needs an explicit choice and defaults off/,
    /first issue is blocked by the second/,
    /exactly one supported key: `text`, `number`, `date`, `singleSelectOptionId`, or `iterationId`/,
    /Use actual IDs from that project/,
    /Do not silently alter reviewed text to fit/,
  ]) assert.match(text, pattern)
})

test('selective adaptation avoids automatic dispatch, stores, scratch files and external setup', async () => {
  const text = await readFile(path, 'utf8')
  for (const pattern of [
    /not a rigid planning schema/,
    /Do not create scratch files, a draft store, persistent project\/session mappings, or automatic labels/,
    /Do not require an external skill setup workflow/,
    /Do not require exhaustive interviewing/,
    /do not force every task through schema, API, and UI/,
    /Do not automatically create a separate specification issue/,
    /Do not install dependencies.*apply profiles.*restart services automatically/,
    /Do not implement code, dispatch agents to implement tasks, or synchronize progress automatically/,
    /Publication is the end.*not authorization to start implementation/,
    /Only this local skill is needed at runtime/,
  ]) assert.match(text, pattern)
  assert.deepEqual((await readdir(root)).sort(), ['LICENSE.matt-pocock', 'SKILL.md'], 'no imported skill collection, draft schema, scripts or setup dependency')
})

test('adaptation records all three pinned sources and retains the full MIT attribution and disclaimer', async () => {
  const text = await readFile(path, 'utf8')
  assert.ok(text.includes(`https://github.com/mattpocock/skills/tree/${sourceCommit}`))
  for (const source of ['skills/productivity/grilling/SKILL.md', 'skills/engineering/to-spec/SKILL.md', 'skills/engineering/to-tickets/SKILL.md']) assert.ok(text.includes(source))
  assert.ok(text.includes('LICENSE.matt-pocock'))
  const license = await readFile(join(root, 'LICENSE.matt-pocock'), 'utf8')
  assert.equal(license, `MIT License

Copyright (c) 2026 Matt Pocock

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`)
})

test('walkthrough documents conversational review, individually approved publication and fixture validation limits', async () => {
  const readme = await readFile(join(packageRoot, 'README.md'), 'utf8')
  assert.match(readme, /walkthrough/i)
  assert.match(readme, /github_create_project/)
  assert.match(readme, /github_create_issue/)
  assert.match(readme, /github_add_issue_dependency/)
  assert.match(readme, /fixture/i)
  assert.match(readme, /live/i)
  assert.match(readme, /approval/i)
  assert.match(readme, /restart/i)
})
