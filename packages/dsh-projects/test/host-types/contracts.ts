import type { ProjectSource, Request, RpcResult, Catalog } from '../../shared/contracts.js'

declare const request: Request
void request('catalog', {})
void request('issues', { projectId: 'app', sourceId: 'source', limit: 20 })
// @ts-expect-error unknown endpoint must not expose tracker mutation
void request('delete', {})
// @ts-expect-error issue reads require an explicit configured source
void request('issues', { projectId: 'app' })
// @ts-expect-error catalog accepts no session authority
void request('catalog', { sessionId: 'session' })
// @ts-expect-error configuration requires optimistic concurrency revision
void request('configure', { configuration: { teams: [], projects: [] } })
const source: ProjectSource = { id: 'repo', kind: 'github-repository', owner: 'acme', repo: 'app' }
void source
// @ts-expect-error target fields cannot cross source discriminants
const wrong: ProjectSource = { id: 'team', kind: 'linear-team', project: 'uuid' }
void wrong
declare const result: RpcResult<Catalog>
if (result.ok) {
  void result.value.projects
} else {
  void result.error.code
}
// @ts-expect-error result must be narrowed before reading successful value
void result.value
