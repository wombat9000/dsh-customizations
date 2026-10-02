import type { LinearListIssuesArgs, LinearIssueRead, LinearProjectRead } from './contracts.js'
export type { LinearListIssuesArgs, LinearIssueRead, LinearProjectRead } from './contracts.js'
export interface LinearReadOptions {
  signal?: AbortSignal
}
export interface LinearIssuePage {
  issues: LinearIssueRead[]
  pageInfo: { hasNextPage: boolean; nextCursor?: string }
}
export interface LinearReads {
  listIssues(args?: LinearListIssuesArgs, options?: LinearReadOptions): Promise<LinearIssuePage>
  getIssue(args: { issue: string }, options?: LinearReadOptions): Promise<LinearIssueRead>
  getProject(args: { project: string }, options?: LinearReadOptions): Promise<LinearProjectRead>
}
export interface LinearReadRuntime {
  listIssues(args: LinearListIssuesArgs, signal: AbortSignal): Promise<LinearIssuePage>
  getIssue(args: { issue: string }, signal: AbortSignal): Promise<LinearIssueRead>
  getProject(args: { project: string }, signal: AbortSignal): Promise<LinearProjectRead>
}
interface ReadArguments {
  listIssues: LinearListIssuesArgs
  getIssue: { issue: string }
  getProject: { project: string }
}
interface ReadResults {
  listIssues: LinearIssuePage
  getIssue: LinearIssueRead
  getProject: LinearProjectRead
}
export const LINEAR_READ_SERVICE = 'localLinearReads'
declare module '@deepseek-ai/cordis' {
  interface Context {
    localLinearReads: Readonly<LinearReads>
  }
}
const messages = {
  INVALID_ARGUMENT: 'Invalid Linear read arguments.',
  CANCELLED: 'The Linear read was cancelled.',
  TIMEOUT: 'The Linear read exceeded its time limit.',
  READ_FAILED:
    'The Linear read failed. Check the workspace connection and permissions in Plugins → Linear → Configure.',
}
export class LinearReadError extends Error {
  code: keyof typeof messages
  constructor(code: keyof typeof messages) {
    super(messages[code])
    this.name = 'LinearReadError'
    this.code = code
  }
}
const strings = ['team', 'assignee', 'project', 'cycle', 'updatedAfter', 'createdAfter', 'cursor']
function validate<M extends keyof ReadArguments>(method: M, input: unknown): ReadArguments[M] {
  const keys =
    method === 'listIssues'
      ? [...strings, 'states', 'priorities', 'labels', 'orderBy', 'limit', 'includeArchived']
      : [method === 'getIssue' ? 'issue' : 'project']
  const invalid = (): never => {
    throw new LinearReadError('INVALID_ARGUMENT')
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid()
  const args = input as Record<string, unknown>
  if (Object.keys(args).some((key) => !keys.includes(key))) invalid()
  const nonempty = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0 && value.length <= 4096
  for (const key of [...strings, 'issue'])
    if (args[key] !== undefined && !nonempty(args[key])) invalid()
  if (method !== 'listIssues' && !nonempty(args[keys[0]!])) invalid()
  for (const key of ['states', 'labels']) {
    const value = args[key]
    if (
      value !== undefined &&
      (!Array.isArray(value) || value.length > 100 || !value.every(nonempty))
    )
      invalid()
  }
  if (
    args.priorities !== undefined &&
    (!Array.isArray(args.priorities) ||
      args.priorities.length > 100 ||
      args.priorities.some(
        (v: unknown) => typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 4,
      ))
  )
    invalid()
  if (
    args.limit !== undefined &&
    (typeof args.limit !== 'number' ||
      !Number.isInteger(args.limit) ||
      args.limit < 1 ||
      args.limit > 50)
  )
    invalid()
  if (args.orderBy !== undefined && args.orderBy !== 'updatedAt' && args.orderBy !== 'createdAt')
    invalid()
  if (args.includeArchived !== undefined && typeof args.includeArchived !== 'boolean') invalid()
  if (Array.isArray(args.states) && args.states.length && !args.team) invalid()
  // All allowed fields are validated above; preserve the existing shallow-copy
  // boundary for the validated request queued for dispatch.
  return { ...args } as unknown as ReadArguments[M]
}

// Uses the same runtime and host credentials as tools; never resolves an agent session.
export function createLinearReads(runtime: LinearReadRuntime, { timeoutMs = 30000 } = {}) {
  const lifetime = new AbortController()
  const deadline = Number.isFinite(timeoutMs) ? Math.max(1, Math.min(120000, timeoutMs)) : 30000
  const run = async <M extends keyof ReadArguments>(
    method: M,
    input: unknown = {},
    options: LinearReadOptions = {},
  ): Promise<ReadResults[M]> => {
    const args = validate(method, input)
    const controller = new AbortController()
    const signal = AbortSignal.any([
      controller.signal,
      lifetime.signal,
      ...(options.signal ? [options.signal] : []),
    ])
    let timedOut = false
    let abort: (() => void) | undefined
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, deadline)
    try {
      if (signal.aborted) throw new LinearReadError('CANCELLED')
      const cancelled = new Promise<never>((_, reject) => {
        abort = () => reject(new LinearReadError(timedOut ? 'TIMEOUT' : 'CANCELLED'))
        signal.addEventListener('abort', abort, { once: true })
      })
      return await Promise.race([
        Promise.resolve().then(() => {
          if (signal.aborted) throw new LinearReadError(timedOut ? 'TIMEOUT' : 'CANCELLED')
          // A method's argument/result pair is indexed together in the contracts.
          const dispatch = runtime[method] as (
            args: ReadArguments[M],
            signal: AbortSignal,
          ) => Promise<ReadResults[M]>
          return dispatch.call(runtime, args, signal)
        }),
        cancelled,
      ])
    } catch (error) {
      if (signal.aborted) throw new LinearReadError(timedOut ? 'TIMEOUT' : 'CANCELLED')
      if (error instanceof LinearReadError) throw error
      // SDK diagnostics, resolver selectors, and credential exceptions stay host-side.
      throw new LinearReadError('READ_FAILED')
    } finally {
      clearTimeout(timer)
      if (abort) signal.removeEventListener('abort', abort)
    }
  }
  const service: Readonly<LinearReads> = Object.freeze({
    listIssues: (args?: LinearListIssuesArgs, options?: LinearReadOptions) =>
      run('listIssues', args, options),
    getIssue: (args: { issue: string }, options?: LinearReadOptions) =>
      run('getIssue', args, options),
    getProject: (args: { project: string }, options?: LinearReadOptions) =>
      run('getProject', args, options),
  })
  return { service, dispose: () => lifetime.abort() }
}
export function mountLinearReads(
  ctx: {
    effect(callback: () => () => void): unknown
    provide(name: string, service: Readonly<LinearReads>): unknown
  },
  runtime: LinearReadRuntime,
  config?: { timeoutMs?: number },
): Readonly<LinearReads> {
  const reads = createLinearReads(runtime, config)
  ctx.effect(() => () => reads.dispose())
  ctx.provide(LINEAR_READ_SERVICE, reads.service)
  return reads.service
}
