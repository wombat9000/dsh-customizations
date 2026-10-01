import { GitHubError, runCollected, isGitHubBackendFenced } from './runtime.js'

// Fixed descriptors come from the GitHub adapters, never from tool arguments.
// Both reads and writes retain the managed backend's cancellation/quiescence boundary.
export function createGitHubAPITransport(
  subprocess,
  { timeoutMs = 30000, maxOutputBytes = 1048576 } = {},
) {
  return async (request, exec, onDispatch) => {
    if (isGitHubBackendFenced(subprocess))
      throw new GitHubError(
        'CLEANUP_FAILED',
        'This GitHub backend is fenced after an unconfirmed process cleanup. Verify and replace or restart it before proceeding.',
      )
    if (exec.signal?.aborted)
      throw new GitHubError('CANCELLED', 'The GitHub operation was cancelled before dispatch.')
    let executable
    const resolution = Promise.resolve(subprocess.resolveExecutable('gh', undefined, exec.signal))
    try {
      if (!exec.signal) executable = await resolution
      else
        executable = await new Promise((resolve, reject) => {
          const abort = () =>
            reject(
              new GitHubError('CANCELLED', 'The GitHub operation was cancelled before dispatch.'),
            )
          exec.signal.addEventListener('abort', abort, { once: true })
          resolution
            .then(resolve, reject)
            .finally(() => exec.signal.removeEventListener('abort', abort))
          if (exec.signal.aborted) abort()
        })
    } catch (error) {
      if (exec.signal?.aborted)
        throw new GitHubError('CANCELLED', 'The GitHub operation was cancelled before dispatch.')
      throw new GitHubError(
        'CLI_UNAVAILABLE',
        'GitHub CLI is unavailable in the managed backend. No request was dispatched.',
      )
    }
    if (typeof executable !== 'string' || !executable)
      throw new GitHubError(
        'CLI_UNAVAILABLE',
        'GitHub CLI is unavailable in the managed backend. No request was dispatched.',
      )
    const graphql = typeof request.document === 'string'
    const body = graphql
      ? { query: request.document, variables: request.variables ?? {} }
      : request.body
    return runCollected(subprocess, {
      argv: [
        executable,
        'api',
        graphql ? 'graphql' : request.path,
        '--hostname',
        'github.com',
        '--method',
        graphql ? 'POST' : request.method,
        '--header',
        'Accept: application/vnd.github+json',
        '--header',
        'X-GitHub-Api-Version: 2026-03-10',
        ...(body === undefined ? [] : ['--input', '-']),
      ],
      ...(body === undefined ? {} : { stdinData: JSON.stringify(body) }),
      cwd: exec.cwd,
      signal: exec.signal,
      timeoutMs,
      maxOutputBytes,
      onDispatch,
    })
  }
}

export function parseGitHubAPIResponse(response, request) {
  let parsed
  try {
    parsed = JSON.parse(response.stdout)
  } catch {
    /* Diagnostics are classified, never returned verbatim. */
  }
  if (response.exitCode !== 0 || parsed?.errors?.length) {
    const text = `${response.stderr}\n${JSON.stringify(parsed?.errors ?? parsed?.message ?? '')}`
    const code = /rate.limit|HTTP 429/i.test(text)
      ? 'RATE_LIMITED'
      : /HTTP 401|bad credentials|authentication|gh auth login/i.test(text)
        ? 'AUTH_REQUIRED'
        : /HTTP 404|not.found|could not resolve to/i.test(text)
          ? 'NOT_FOUND'
          : /HTTP 403|forbidden|insufficient|scope|resource not accessible/i.test(text)
            ? 'PERMISSION_DENIED'
            : /HTTP 409/i.test(text)
              ? 'CONFLICT'
              : /HTTP 422|validation failed/i.test(text)
                ? 'INVALID_ARGUMENT'
                : 'READ_FAILED'
    throw new GitHubError(
      code,
      'The GitHub request failed. The resource or feature may be unavailable or inaccessible; no raw diagnostic is exposed.',
    )
  }
  const data = typeof request.document === 'string' ? parsed?.data : parsed
  if (data === null || typeof data !== 'object')
    throw new GitHubError(
      'INVALID_RESPONSE',
      'GitHub returned an incomplete or malformed response.',
    )
  return data
}
