import assert from 'node:assert/strict'
import test from 'node:test'
import {
  configuration,
  parseConfiguration,
  projectViews,
  revisionOf,
} from '../dist/src/configuration.js'
import { config } from './fixtures.js'

test('team conventions inherit, project values override, and empty project values explicitly clear', () => {
  const parsed = configuration(config())
  const [project] = projectViews(parsed)
  assert.equal(project.teamName, 'Platform')
  assert.deepEqual(project.effectiveConventions, {
    workflow: 'Review first',
    development: 'Run focused tests',
    agentBoundaries: '',
  })
  assert.deepEqual(project.conventionOrigins, {
    workflow: 'team',
    development: 'project',
    agentBoundaries: 'project',
  })
  assert.equal(parsed.teams[0].conventions.agentBoundaries, 'Do not deploy')
  const standalone = config()
  delete standalone.projects[0].teamId
  assert.equal(projectViews(configuration(standalone))[0].teamName, undefined)
  assert.equal(projectViews(configuration(standalone))[0].effectiveConventions.workflow, undefined)
  assert.equal(revisionOf(parsed), revisionOf(parseConfiguration(JSON.stringify(parsed))))
  const changed = config()
  changed.projects[0].name = 'Changed'
  assert.notEqual(revisionOf(configuration(changed)), revisionOf(parsed))
})

test('configuration rejects unknown properties, duplicate IDs, dangling teams, invalid targets and unbounded input', () => {
  const mutations = [
    (c) => {
      c.extra = true
    },
    (c) => {
      c.teams[0].extra = true
    },
    (c) => {
      c.projects[0].conventions.execute = 'write'
    },
    (c) => {
      c.projects[0].sources[0].query = 'mutation {}'
    },
    (c) => {
      c.teams.push(c.teams[0])
    },
    (c) => {
      c.projects.push(c.projects[0])
    },
    (c) => {
      c.projects[0].sources.push(c.projects[0].sources[0])
    },
    (c) => {
      c.projects[0].teamId = 'missing'
    },
    (c) => {
      c.projects[0].id = '../escape'
    },
    (c) => {
      c.projects[0].sources[0].owner = 'https://github.com/acme'
    },
    (c) => {
      c.projects[0].sources[0].repo = '..'
    },
    (c) => {
      c.projects[0].sources[0].kind = 'search'
    },
    (c) => {
      c.projects[0].sources[1].projectNumber = 0
    },
    (c) => {
      c.projects[0].sources[1].projectNumber = 1.5
    },
    (c) => {
      c.projects[0].sources[1].projectNumber = 2147483648
    },
    (c) => {
      c.projects[0].sources[2].project = 'Platform project'
    },
    (c) => {
      c.projects[0].sources[3].team = 'ENG'
    },
    (c) => {
      c.projects[0].name = ' '
    },
    (c) => {
      c.projects[0].name = 'bad\u0000name'
    },
    (c) => {
      c.projects[0].description = 'a'.repeat(4001)
    },
    (c) => {
      c.projects[0].conventions.workflow = 'a'.repeat(8001)
    },
    (c) => {
      c.projects[0].sources = Array.from({ length: 11 }, (_, i) => ({
        ...c.projects[0].sources[0],
        id: `s${i}`,
      }))
    },
    (c) => {
      c.teams = Array.from({ length: 101 }, (_, i) => ({ id: `t${i}`, name: 'Team' }))
    },
  ]
  for (const mutate of mutations) {
    const c = config()
    mutate(c)
    assert.throws(() => configuration(c), { code: 'invalid' }, String(mutate))
  }
  for (const value of [null, [], new Date(), { teams: [], projects: [null] }])
    assert.throws(() => configuration(value), { code: 'invalid' })
  for (const value of [
    'invalid JSON',
    JSON.stringify({ teams: [], projects: [], secret: true }),
    ' '.repeat(262145),
  ])
    assert.throws(() => parseConfiguration(value), { code: 'invalid' })
  const large = {
    teams: [],
    projects: Array.from({ length: 40 }, (_, i) => ({
      id: `p${i}`,
      name: 'Project',
      sources: [],
      conventions: { workflow: 'a'.repeat(8000) },
    })),
  }
  assert.throws(() => configuration(large), { code: 'invalid' })
})
