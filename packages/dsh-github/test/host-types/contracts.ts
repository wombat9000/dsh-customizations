// Compile-only service regressions. An unused expectation fails strict checking.
import type { GitHubReads } from '../../src/reads.js'
import { createGitHubRuntime } from '../../src/runtime.js'
import type { Subprocess } from '../../src/contracts.js'
import type { GrantRuntime } from '../../src/grant-contracts.js'
import type { APIReader } from '../../src/contracts.js'

export async function readServiceContracts(reads: GitHubReads, subprocess: Subprocess) {
  const runtime: GitHubReads = createGitHubRuntime(subprocess)
  const result = await reads.listIssues({ owner: 'acme', repo: 'example', state: 'open' })
  const host: 'github.com' = result.host
  // @ts-expect-error Provider fields remain unknown until the consumer narrows them.
  result.data.nodes.map((issue: { title: string }) => issue.title)
  // @ts-expect-error The read facade cannot create an issue or acquire grant authority.
  reads.createIssue({ owner: 'acme', repo: 'example', title: 'Title', body: '' })
  // @ts-expect-error Repository targets require an explicit repository.
  reads.listIssues({ owner: 'acme' })
  // @ts-expect-error Public issue state is a closed union.
  reads.listIssues({ owner: 'acme', repo: 'example', state: 'merged' })
  // @ts-expect-error IDs and project numbers are distinct contracts.
  reads.getProject({ owner: 'acme', projectNumber: '4' })
  // @ts-expect-error Untrusted callers cannot extend read options with grant authority.
  reads.getProject({ owner: 'acme', projectNumber: 4 }, { session: {} })
  void host
  void runtime
}

export async function lifecycleContracts(grants: GrantRuntime, request: APIReader) {
  const response = await request({ path: '/repos/acme/example', method: 'GET' })
  // @ts-expect-error Transport JSON has not passed PR or project validators.
  response.viewer.id
  // @ts-expect-error A string session ID cannot replace the live root session object.
  grants.list({ session: 'restored-id', agentId: 'agent', cwd: '/', isSubagent: false })
  // @ts-expect-error Grants never deserialize authority from browser-provided strings.
  grants.assert('saved-permit', {}, { session: {}, isSubagent: false })
}
