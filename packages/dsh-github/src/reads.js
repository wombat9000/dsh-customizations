import { GitHubError } from './runtime.js'

export const GITHUB_READ_SERVICE = 'localGitHubReads'

// Host-only facade. No caller session, grant authority, or mutation runtime escapes.
export function createGitHubReads(runtime, { cwd = '/' } = {}) {
  const lifetime = new AbortController()
  const service = Object.fromEntries(
    ['listIssues', 'getIssue', 'listProjectItems', 'getProject'].map((method) => [
      method,
      async (args, options = {}) => {
        const signal = AbortSignal.any([lifetime.signal, ...[options.signal].filter(Boolean)])
        try {
          if (signal.aborted) throw new GitHubError('CANCELLED', 'The GitHub read was cancelled.')
          return await runtime[method](args, { signal, cwd: options.cwd ?? cwd })
        } catch (error) {
          if (error instanceof GitHubError) throw error
          throw new GitHubError(
            'READ_FAILED',
            'The managed GitHub read failed. No raw diagnostic is exposed.',
          )
        }
      },
    ]),
  )
  return { service: Object.freeze(service), dispose: () => lifetime.abort() }
}

export function mountGitHubReads(ctx, runtime) {
  const reads = createGitHubReads(runtime)
  ctx.effect(() => () => reads.dispose())
  ctx.provide(GITHUB_READ_SERVICE, reads.service)
  return reads.service
}
