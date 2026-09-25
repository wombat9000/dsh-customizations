import assert from 'node:assert/strict'
import test from 'node:test'
import { itemConnection, projectItems, projectItemsBlock } from './project-items-fixture.js'
import { registerTypeScript } from './source-loader.mjs'
registerTypeScript()
const { readCardModel, projectItemModel, itemFieldModel } = await import('../client/read-models.ts')
test('six item model preserves independent states, repository fields, PRs and additional fields', () => {
  const model = readCardModel('github_list_project_items', projectItemsBlock())
  assert.equal(model.returnedCount, 6)
  const first = projectItemModel(model.entries[0]),
    second = projectItemModel(model.entries[1])
  assert.equal(first.issueState, 'OPEN')
  assert.equal(first.boardStatus, 'Done')
  assert.equal(second.issueState, 'CLOSED')
  assert.equal(second.boardStatus, 'In progress')
  assert.equal(first.repositories[0].nameWithOwner, 'fixture-org/demo')
  assert.equal(second.repositories[0].nameWithOwner, 'fixture-org/other')
  assert.equal(first.prs[0].pullRequests.nodes[0].number, 20)
  assert.deepEqual(
    Array.from(first.fields, (value) => value.field.name),
    ['Notes', 'Estimate'],
  )
  assert.equal(model.entries[4].isArchived, true)
})
test('missing, empty, null, zero and unexpected fields remain distinct', () => {
  for (const [value, expected] of [
    [{ text: '' }, 'Empty string'],
    [{ number: 0 }, '0'],
    [{ date: null }, 'Not set'],
    [{ repository: { nameWithOwner: 'a/b' } }, 'a/b'],
    [{ repository: null }, 'Not set'],
    [{ future: true }, 'Value not supplied or unsupported'],
    [null, 'See technical details'],
  ])
    assert.equal(itemFieldModel(value).value, expected)
  const missing = projectItemModel({ content: null })
  assert.equal(missing.issueState, 'Unknown item type')
  assert.equal(missing.boardStatus, 'Not supplied')
  assert.equal(
    projectItemModel({ content: { __typename: 'DraftIssue', title: '' } }).title,
    'Empty title',
  )
  assert.equal(
    projectItemModel({ content: { __typename: 'PullRequest', state: 'CLOSED' } }).issueState,
    'Not an issue',
  )
})
test('direct malformed item field nodes stay defensive while read cards reject them', () => {
  for (const nodes of [null, {}, 'not an array', 42]) {
    const entry = { id: 'ITEM', content: null, fieldValues: { nodes } }
    const model = projectItemModel(entry)
    assert.deepEqual(model.fields, [])
    assert.deepEqual(model.prs, [])
    assert.equal(model.boardStatus, 'Not supplied')
    assert.equal(
      readCardModel('github_list_project_items', projectItemsBlock({ nodes: [entry] })).state,
      'unknown',
    )
  }
})
test('outer and nested incompleteness remain visible independently of expanded items', () => {
  const item = structuredClone(projectItems[0])
  item.fieldValues.nodes[3].pullRequests = itemConnection([], true)
  const data = { ...itemConnection([item], true), totalCount: 30 }
  const model = readCardModel(
    'github_list_project_items',
    projectItemsBlock(data, { truncated: true }),
  )
  assert.equal(model.returnedCount, 1)
  assert.equal(model.total, 30)
  assert.ok(model.warnings.some((value) => value.includes('pullRequests')))
  assert.ok(model.warnings.some((value) => value.startsWith('data:')))
  assert.equal(
    readCardModel('github_list_project_items', projectItemsBlock({ nodes: [null] })).state,
    'unknown',
  )
})
