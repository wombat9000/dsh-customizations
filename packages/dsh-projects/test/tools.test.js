import assert from 'node:assert/strict'
import test from 'node:test'
import { createProjectTools } from '../dist/src/tools.js'
import { fixture, github } from './fixtures.js'

test('three read-only tools share the Projects service and never expose configure or tracker mutation', async () => {
  const calls = []
  const { service, state } = fixture({
    github: {
      listIssues: async (args, options) => {
        calls.push({ args, options })
        return github()
      },
    },
  })
  const tools = createProjectTools(service)
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['projects_list', 'projects_get', 'projects_list_issues'],
  )
  const execution = { signal: new AbortController().signal }
  for (const tool of tools) {
    assert.equal(tool.parameters.additionalProperties, false)
    assert.equal(tool.isConcurrencySafe(), true)
    assert.match(tool.description, /Read-only/)
    assert.equal(tool.timeoutMs, 40000)
    assert.deepEqual(tool.output.render({}, 'value'), [{ type: 'text', text: 'value' }])
  }
  const catalog = JSON.parse(await tools[0].execute({}, execution))
  assert.equal(catalog.projects[0].id, service.catalog().projects[0].id)
  assert.equal(catalog.configuration, undefined)
  const project = JSON.parse(await tools[1].execute({ projectId: 'app' }, execution))
  assert.deepEqual(project, service.project({ projectId: 'app' }))
  const page = JSON.parse(await tools[2].execute({ projectId: 'app', sourceId: 'repo' }, execution))
  assert.equal(page.projectId, 'app')
  assert.equal(calls.length, 1)
  assert.equal(state.saves.length, 0)
  assert.equal(
    JSON.parse(await tools[0].execute({ configure: true }, execution)).error.code,
    'invalid',
  )
})

test('tool failures and stopped service errors use safe JSON, never arbitrary diagnostics', async () => {
  const tools = createProjectTools({
    catalog: () => {
      throw new Error('Bearer private')
    },
  })
  const result = JSON.parse(await tools[0].execute({}, { signal: new AbortController().signal }))
  assert.equal(result.error.code, 'failed')
  assert.doesNotMatch(JSON.stringify(result), /private|Bearer/)
  const { service } = fixture()
  service.dispose()
  assert.equal(
    JSON.parse(
      await createProjectTools(service)[0].execute({}, { signal: new AbortController().signal }),
    ).error.code,
    'stopped',
  )
})
