import type { GitHubAccount, GitHubCaller } from './contracts.js'
import type { PreparedWrite, WriteResult, GitHubWriteRuntime } from './write-contracts.js'
import type { GrantCaller, GrantRuntime } from './grant-contracts.js'
import { GitHubError } from './runtime.js'
import { uncertainWriteResult } from './write-runtime.js'

export const failedWriteResult = (error: unknown): WriteResult => ({
  host: 'github.com',
  outcome: 'failed',
  error: {
    code: error instanceof GitHubError ? error.code : 'READ_FAILED',
    message:
      error instanceof GitHubError
        ? error.message
        : 'The GitHub write failed before dispatch. No raw diagnostic is exposed.',
  },
})

// Call bindings and approval policy belong to the Tools adapter. This coordinator
// retains grant authority and execution evidence behind per-call opaque handles.
export function createGitHubWriteAttempts(
  runtime: GitHubWriteRuntime,
  { grants }: { grants?: GrantRuntime | undefined } = {},
) {
  const attempts = new WeakMap<
    object,
    {
      prepared: PreparedWrite
      permit: object | null
      history: object | null
      consumed: boolean
      dispatched: boolean
      result?: WriteResult
    }
  >()

  function observeAccount(actor: GitHubAccount, owner: GrantCaller | undefined) {
    grants?.observeAccount(actor)
    if (owner?.isSubagent === false) grants?.observe(actor, owner)
  }

  async function prepareAttempt(
    operation: string,
    args: unknown,
    caller: GitHubCaller,
    grantCaller?: () => GrantCaller | undefined,
  ) {
    const owner = grantCaller?.()
    const eligible = grants && owner?.isSubagent === false
    let prepared
    try {
      prepared = await runtime.prepare(operation, args, caller, {
        onAccount: (actor) => observeAccount(actor, owner),
      })
    } catch (error) {
      if (eligible) {
        // Failed preflight verifies no targets. Retain neither raw arguments nor
        // diagnostics, and do not let cancellation confer authority.
        try {
          const history = grants.attempt(
            { operation, knownTargets: {} },
            { ...owner, signal: undefined },
          )
          grants.outcome(history, 'failed')
        } catch {
          /* A disposed session cannot retain new history. */
        }
      }
      throw error
    }
    if (caller.signal?.aborted) return null
    const noChange = operation === 'setProjectItemField' && prepared.change?.noChange === true
    const permit = eligible && !noChange ? grants.check(prepared, owner) : null
    const history = eligible && !noChange ? grants.attempt(prepared, owner) : null
    const attempt = Object.freeze({})
    attempts.set(attempt, { prepared, permit, history, consumed: false, dispatched: false })
    return { attempt, prepared, authorizedByGrant: !!permit, noChange }
  }

  async function executeAttempt(
    attempt: object,
    caller: GitHubCaller,
    grantCaller?: () => GrantCaller | undefined,
    { onDispatch }: { onDispatch?: () => void } = {},
  ) {
    const record = attempts.get(attempt)
    if (!record || record.consumed)
      throw new GitHubError(
        'APPROVAL_REQUIRED',
        'No unused approval preparation matches this exact GitHub write call, arguments and caller.',
      )
    record.consumed = true
    try {
      const owner = grantCaller?.()
      record.result = await runtime.execute(record.prepared, caller, {
        onAccount: (actor) => observeAccount(actor, owner),
        beforeDispatch: () => {
          // The runtime invokes this synchronously after queueing and executable
          // resolution. Never reuse the caller observed at preparation or execution.
          if (record.permit) grants!.assert(record.permit, record.prepared, grantCaller?.())
        },
        onDispatch: () => {
          record.dispatched = true
          if (record.history) grants!.outcome(record.history, 'running')
          onDispatch?.()
        },
      })
      if (record.history) grants!.outcome(record.history, record.result.outcome)
      return record.result
    } catch (error) {
      record.result = record.dispatched
        ? uncertainWriteResult(record.prepared)
        : failedWriteResult(error)
      if (record.history) grants!.outcome(record.history, record.result.outcome)
      return record.result
    }
  }

  function finalizeAttempt(
    attempt: object | undefined,
    { cancelled, isError }: { cancelled?: boolean | undefined; isError?: boolean | undefined },
  ) {
    const record = attempt ? attempts.get(attempt) : undefined
    if (!record?.dispatched) return undefined
    if (cancelled || isError) {
      record.result = {
        ...uncertainWriteResult(record.prepared),
        ...(record.result?.outcome === 'confirmed'
          ? { observedConfirmedResource: record.result.resource }
          : record.result?.observedConfirmedResource
            ? { observedConfirmedResource: record.result.observedConfirmedResource }
            : {}),
        ...(record.result?.observedResources
          ? { observedResources: record.result.observedResources }
          : {}),
        ...(record.result?.backendFenced
          ? { backendFenced: true, cleanupWarning: record.result.cleanupWarning }
          : {}),
      }
    }
    // Persist uncertainty in the attempt as well as history. A later finalization
    // cannot restore confirmation after Tools normalized a late cancellation.
    record.result ??= uncertainWriteResult(record.prepared)
    if (record.history) grants!.outcome(record.history, record.result.outcome)
    return record.result
  }

  return Object.freeze({ prepareAttempt, executeAttempt, finalizeAttempt })
}
