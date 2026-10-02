import { property, object } from './contracts.js'
import type { PreparedWrite, WriteResult } from './write-contracts.js'
import type { GrantScope, GrantRuntime, Grant, GrantHistory } from './grant-contracts.js'
import type {
  Agent,
  Agents,
  Session,
  Execution,
  CallerFactory,
  PresentationInput,
} from './host-types.js'
import { GRANT_TOOL_NAME } from './grant-tools.js'

export const FIELD_TOOL_NAME = 'github_set_project_item_field'
const pick = (value: unknown, keys: string[]): unknown =>
  value && typeof value === 'object'
    ? Object.fromEntries(
        keys
          .filter((key) => property(value, key) !== undefined)
          .map((key) => [key, property(value, key)]),
      )
    : value
export function fieldPresentation(prepared: PreparedWrite) {
  const change = prepared.change
  const identity = (value: unknown) => pick(value, ['id', 'name', 'dataType'])
  const before =
    change.before == null
      ? change.before
      : {
          ...object(
            pick(change.before, [
              '__typename',
              'text',
              'number',
              'date',
              'optionId',
              'name',
              'iterationId',
              'title',
              'startDate',
              'duration',
            ]),
          ),
          ...(property(change.before, 'field')
            ? { field: identity(property(change.before, 'field')) }
            : {}),
        }
  const content = pick(property(prepared.targets.item, 'content'), [
    '__typename',
    'id',
    'number',
    'title',
    'url',
  ])
  return {
    exactPreview: prepared.preview,
    targets: {
      project: pick(prepared.targets.project, ['id', 'number', 'title', 'url']),
      item: {
        id: property(prepared.targets.item, 'id'),
        content,
        project: pick(property(prepared.targets.item, 'project'), ['id']),
      },
    },
    change: {
      field: identity(change.field),
      before,
      after: pick(change.after, ['text', 'number', 'date', 'singleSelectOptionId', 'iterationId']),
      selectedOption: pick(change.selectedOption, ['id', 'name', 'title', 'startDate', 'duration']),
    },
  }
}

// Presentation data never confers authority. Opaque grant/write tokens remain
// private to their runtimes. Eviction/restoration deliberately loses previews.
interface PresentationRecord extends Record<string, unknown> {
  version: number
  phase: string
  toolName?: string
  callId?: string
  result?: Record<string, unknown>
  grantId?: string
}
export function createGitHubPresentation({
  agents,
  grants,
  caller,
}: {
  agents: Agents
  grants: GrantRuntime
  caller: CallerFactory
}) {
  const sessions = new Map<Session, Map<string, PresentationRecord>>()
  let active = true
  function live(agent: Agent | undefined): agent is Agent {
    return active && !!agent?.session && agents?.get(agent.session.id) === agent
  }
  function records(agent: Agent | undefined) {
    if (!live(agent)) return undefined
    let state = sessions.get(agent.session)
    if (!state) {
      state = new Map()
      sessions.set(agent.session, state)
    }
    return state
  }
  function store(exec: Execution, value: Record<string, unknown> & { phase: string }) {
    const state = records(exec.agent)
    if (!state || typeof exec.callId !== 'string' || !exec.callId) return
    if (!state.has(exec.callId) && state.size >= 100) state.delete(state.keys().next().value!)
    state.set(exec.callId, { version: 1, toolName: exec.name, callId: exec.callId, ...value })
  }
  function request(exec: Execution, scope: GrantScope, exactPreview: string) {
    store(exec, { scope, exactPreview, phase: 'prepared' })
  }
  function prepared(exec: Execution, value: PreparedWrite, phase: string) {
    if (exec.name === FIELD_TOOL_NAME) store(exec, { ...fieldPresentation(value), phase })
  }
  function settled(exec: Execution, value: WriteResult) {
    if (exec.name !== FIELD_TOOL_NAME) return
    const result = {
      ...object(
        pick(value, [
          'host',
          'operation',
          'outcome',
          'dispatched',
          'reason',
          'message',
          'backendFenced',
          'cleanupWarning',
        ]),
      ),
      ...(value.error ? { error: pick(value.error, ['code', 'message']) } : {}),
    }
    const state = records(exec.agent)
    const item = state?.get(exec.callId)
    // Uncertainty wins even if a later normalization retained a confirmed value.
    if (item?.result?.outcome === 'uncertain') return
    if (item) {
      item.result = result
      item.phase = value.outcome
    } else store(exec, { result, phase: value.outcome })
  }
  function phase(exec: Execution, value: string) {
    const item = records(exec.agent)?.get(exec.callId)
    if (item) item.phase = value
    else if (exec.name === GRANT_TOOL_NAME) store(exec, { phase: value })
  }
  function granted(exec: Execution, grant: Grant) {
    const item = records(exec.agent)?.get(exec.callId)
    if (item) {
      item.grantId = grant.id
      item.phase = 'active'
    }
  }
  function resolve(input: PresentationInput) {
    if (!input || typeof input.sessionId !== 'string' || typeof input.callId !== 'string')
      throw new Error('Invalid GitHub presentation target.')
    const agent = agents?.get(input.sessionId)
    if (!live(agent)) return undefined
    return agent
  }
  function approvalPhase(session: Session, callId: string, toolName: string | undefined) {
    // Read only the required audit leaves; never serialize a live Session.
    const decisions = new Map<unknown, unknown>()
    for (let seq = session.seq - 1, count = 0; seq >= 0 && count < 2000; seq--, count++) {
      const event = object(session.eventAt(seq))
      const data = object(event?.data) ?? {}
      if (event?.type === 'approval/decided') decisions.set(data.id, data.outcome)
      if (
        event?.type === 'approval/asked' &&
        data.callId === callId &&
        data.toolName === toolName
      ) {
        const outcome = decisions.get(data.id)
        return outcome === undefined
          ? 'awaiting-approval'
          : outcome === 'allowed-once'
            ? 'approved'
            : outcome === 'rejected'
              ? 'denied'
              : 'unattempted'
      }
    }
  }
  function status(input: PresentationInput) {
    const agent = resolve(input)
    if (!agent) return { version: 1, phase: 'expired', grants: [], history: [] }
    const exec = caller({ agent })
    const entry = sessions.get(agent.session)?.get(input.callId)
    const result: PresentationRecord & {
      grants: Grant[]
      history: GrantHistory[]
      historyTruncated: boolean
    } = {
      ...(entry ? { ...entry } : { version: 1, phase: 'expired' }),
      grants: [],
      history: [],
      historyTruncated: false,
    }
    if (entry && ['prepared', 'authorized-by-grant', 'unattempted'].includes(entry.phase)) {
      const auditPhase = approvalPhase(agent.session, input.callId, entry.toolName)
      if (entry.phase !== 'unattempted' || auditPhase === 'denied')
        result.phase = auditPhase ?? entry.phase
    }
    const root = exec.isSubagent === false
    result.grants = root ? grants.list(exec) : []
    result.history = root ? grants.history(exec) : []
    result.historyTruncated = root ? (grants.historyTruncated?.(exec) ?? false) : false
    if (result.toolName === GRANT_TOOL_NAME && result.phase === 'active') {
      if (result.grantId)
        result.phase = result.grants.find((g) => g.id === result.grantId)?.state ?? 'expired'
      else if (!result.grants.some((g) => g.state === 'active')) result.phase = 'expired'
    }
    return result
  }
  function revoke(input: PresentationInput & { grantId: string }) {
    const agent = resolve(input)
    if (!agent) throw new Error('GitHub session expired.')
    grants.revoke(input.grantId, caller({ agent }))
    return status(input)
  }
  function disposeSession(session: Session) {
    sessions.delete(session)
  }
  function dispose() {
    active = false
    sessions.clear()
  }
  return Object.freeze({
    request,
    granted,
    prepared,
    settled,
    phase,
    status,
    revoke,
    disposeSession,
    dispose,
  })
}
