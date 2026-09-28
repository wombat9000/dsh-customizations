export const LINEAR_READ_SERVICE = 'localLinearReads'

const messages = {
  INVALID_ARGUMENT: 'Invalid Linear read arguments.',
  CANCELLED: 'The Linear read was cancelled.',
  TIMEOUT: 'The Linear read exceeded its time limit.',
  READ_FAILED:
    'The Linear read failed. Check the workspace connection and permissions in Plugins → Linear → Configure.',
}
export class LinearReadError extends Error {
  constructor(code) {
    super(messages[code])
    this.name = 'LinearReadError'
    this.code = code
  }
}
const strings = ['team', 'assignee', 'project', 'cycle', 'updatedAfter', 'createdAfter', 'cursor']
function validate(method, args) {
  const keys =
    method === 'listIssues'
      ? [...strings, 'states', 'priorities', 'labels', 'orderBy', 'limit', 'includeArchived']
      : [method === 'getIssue' ? 'issue' : 'project']
  const invalid = () => {
    throw new LinearReadError('INVALID_ARGUMENT')
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) invalid()
  if (Object.keys(args).some((key) => !keys.includes(key))) invalid()
  const nonempty = (value) =>
    typeof value === 'string' && value.trim().length > 0 && value.length <= 4096
  for (const key of [...strings, 'issue'])
    if (args[key] !== undefined && !nonempty(args[key])) invalid()
  if (method !== 'listIssues' && !nonempty(args[keys[0]])) invalid()
  for (const key of ['states', 'labels']) {
    if (
      args[key] !== undefined &&
      (!Array.isArray(args[key]) || args[key].length > 100 || !args[key].every(nonempty))
    )
      invalid()
  }
  if (
    args.priorities !== undefined &&
    (!Array.isArray(args.priorities) ||
      args.priorities.length > 100 ||
      args.priorities.some((v) => !Number.isInteger(v) || v < 0 || v > 4))
  )
    invalid()
  if (
    args.limit !== undefined &&
    (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 50)
  )
    invalid()
  if (args.orderBy !== undefined && !['updatedAt', 'createdAt'].includes(args.orderBy)) invalid()
  if (args.includeArchived !== undefined && typeof args.includeArchived !== 'boolean') invalid()
  if (args.states?.length && !args.team) invalid()
  return { ...args }
}

// Uses the same runtime and host credentials as tools; never resolves an agent session.
export function createLinearReads(runtime, { timeoutMs = 30000 } = {}) {
  const lifetime = new AbortController()
  const deadline = Number.isFinite(timeoutMs) ? Math.max(1, Math.min(120000, timeoutMs)) : 30000
  const service = Object.fromEntries(
    ['listIssues', 'getIssue', 'getProject'].map((method) => [
      method,
      async (input = {}, options = {}) => {
        const args = validate(method, input)
        const controller = new AbortController()
        const signal = AbortSignal.any([
          controller.signal,
          lifetime.signal,
          ...[options.signal].filter(Boolean),
        ])
        let timedOut = false
        let abort
        const timer = setTimeout(() => {
          timedOut = true
          controller.abort()
        }, deadline)
        try {
          if (signal.aborted) throw new LinearReadError('CANCELLED')
          const cancelled = new Promise((_, reject) => {
            abort = () => reject(new LinearReadError(timedOut ? 'TIMEOUT' : 'CANCELLED'))
            signal.addEventListener('abort', abort, { once: true })
          })
          return await Promise.race([
            Promise.resolve().then(() => {
              if (signal.aborted) throw new LinearReadError(timedOut ? 'TIMEOUT' : 'CANCELLED')
              return runtime[method](args, signal)
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
      },
    ]),
  )
  return { service: Object.freeze(service), dispose: () => lifetime.abort() }
}

export function mountLinearReads(ctx, runtime, config) {
  const reads = createLinearReads(runtime, config)
  ctx.effect(() => () => reads.dispose())
  ctx.provide(LINEAR_READ_SERVICE, reads.service)
  return reads.service
}
