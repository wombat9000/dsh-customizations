import { ProjectsService } from '../dist/src/service.js'

export const uuid = '11111111-2222-3333-4444-555555555555'
export const sources = [
  { id: 'repo', kind: 'github-repository', owner: 'acme', repo: 'app' },
  { id: 'board', kind: 'github-project', owner: 'acme', projectNumber: 7 },
  { id: 'linear-project', kind: 'linear-project', project: uuid },
  { id: 'linear-team', kind: 'linear-team', team: uuid },
]
export function config() {
  return {
    teams: [
      {
        id: 'team',
        name: 'Platform',
        conventions: {
          workflow: 'Review first',
          development: 'Run tests',
          agentBoundaries: 'Do not deploy',
        },
      },
    ],
    projects: [
      {
        id: 'app',
        name: 'Application',
        teamId: 'team',
        conventions: { development: 'Run focused tests', agentBoundaries: '' },
        sources: structuredClone(sources),
      },
    ],
  }
}
export const connection = (nodes = [], hasNextPage = false, endCursor = null) => ({
  nodes,
  pageInfo: { hasNextPage, endCursor },
})
export const github = (nodes = [], extra = {}) => ({
  host: 'github.com',
  untrusted: true,
  data: connection(nodes),
  truncated: false,
  truncations: [],
  ...extra,
})
export const linear = (issues = []) => ({ issues, pageInfo: { hasNextPage: false } })
export function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
export function fixture(providers = {}, initial = config()) {
  const state = { json: JSON.stringify(initial), providers, saves: [], beforeSave: undefined }
  const service = new ProjectsService({
    readConfiguration: () => state.json,
    providers: () => state.providers,
    saveConfiguration: async (value) => {
      await state.beforeSave?.()
      state.saves.push(value)
      state.json = value
    },
  })
  return { service, state }
}
