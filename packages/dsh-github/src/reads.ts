import { GitHubError } from './runtime.js'
import type { GitHubReadOptions, GitHubReadResult, GitHubReads } from './contracts.js'
export type {
  GitHubReadOptions,
  GitHubRepositoryTarget,
  GitHubProjectTarget,
  GitHubPage,
  GitHubListIssuesArgs,
  GitHubGetIssueArgs,
  GitHubGetProjectArgs,
  GitHubListProjectItemsArgs,
  GitHubReadResult,
  GitHubReads,
} from './contracts.js'

export const GITHUB_READ_SERVICE = 'localGitHubReads'

// Host-only facade. No caller session, grant authority, or mutation runtime escapes.
export function createGitHubReads(runtime: GitHubReads, { cwd = '/' } = {}) {
  const lifetime = new AbortController()
  function wrap<T>(read: (args: T, options?: GitHubReadOptions) => Promise<GitHubReadResult>) {
    return async (args: T, options: GitHubReadOptions = {}) => {
      const signal = AbortSignal.any([lifetime.signal, ...(options.signal ? [options.signal] : [])])
      try {
        if (signal.aborted) throw new GitHubError('CANCELLED', 'The GitHub read was cancelled.')
        return await read(args, { signal, cwd: options.cwd ?? cwd })
      } catch (error) {
        if (error instanceof GitHubError) throw error
        throw new GitHubError(
          'READ_FAILED',
          'The managed GitHub read failed. No raw diagnostic is exposed.',
        )
      }
    }
  }
  const service: GitHubReads = {
    listIssues: wrap((args, options) => runtime.listIssues(args, options)),
    getIssue: wrap((args, options) => runtime.getIssue(args, options)),
    listProjectItems: wrap((args, options) => runtime.listProjectItems(args, options)),
    getProject: wrap((args, options) => runtime.getProject(args, options)),
  }
  return { service: Object.freeze(service), dispose: () => lifetime.abort() }
}

export function mountGitHubReads(
  ctx: {
    effect(callback: () => () => void): unknown
    provide(name: string, service: Readonly<GitHubReads>): unknown
  },
  runtime: GitHubReads,
) {
  const reads = createGitHubReads(runtime)
  ctx.effect(() => () => reads.dispose())
  ctx.provide(GITHUB_READ_SERVICE, reads.service)
  return reads.service
}
