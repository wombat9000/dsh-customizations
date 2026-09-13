import { GRANT_TOOL_NAME } from './grant-tools.js'

export const FIELD_TOOL_NAME = 'github_set_project_item_field'
const pick = (value, keys) => value && typeof value === 'object'
  ? Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]])) : value
export function fieldPresentation(prepared) {
  const change = prepared.change
  const identity = value => pick(value, ['id', 'name', 'dataType'])
  const before = change.before == null ? change.before : {
    ...pick(change.before, ['__typename', 'text', 'number', 'date', 'optionId', 'name', 'iterationId', 'title', 'startDate', 'duration']),
    ...(change.before?.field ? { field: identity(change.before.field) } : {}),
  }
  const content = pick(prepared.targets.item.content, ['__typename', 'id', 'number', 'title', 'url'])
  return {
    exactPreview: prepared.preview,
    targets: { project: pick(prepared.targets.project, ['id', 'number', 'title', 'url']),
      item: { id: prepared.targets.item.id, content, project: pick(prepared.targets.item.project, ['id']) } },
    change: { field: identity(change.field), before,
      after: pick(change.after, ['text', 'number', 'date', 'singleSelectOptionId', 'iterationId']),
      selectedOption: pick(change.selectedOption, ['id', 'name', 'title', 'startDate', 'duration']) },
  }
}

// Presentation data never confers authority. Opaque grant/write tokens remain
// private to their runtimes. Eviction/restoration deliberately loses previews.
export function createGitHubPresentation({ agents, grants, caller }) {
  const sessions = new Map()
  let active = true
  function live(agent) { return active && !!agent?.session && agents?.get(agent.session.id) === agent }
  function records(agent) {
    if (!live(agent)) return undefined
    let state = sessions.get(agent.session)
    if (!state) { state = new Map(); sessions.set(agent.session, state) }
    return state
  }
  function store(exec, value) {
    const state = records(exec.agent)
    if (!state || typeof exec.callId !== 'string' || !exec.callId) return
    if (!state.has(exec.callId) && state.size >= 100) state.delete(state.keys().next().value)
    state.set(exec.callId, { version: 1, toolName: exec.name, callId: exec.callId, ...value })
  }
  function request(exec, scope, exactPreview) { store(exec, { scope, exactPreview, phase: 'prepared' }) }
  function prepared(exec, value, phase) {
    if (exec.name === FIELD_TOOL_NAME) store(exec, { ...fieldPresentation(value), phase })
  }
  function settled(exec, value) {
    if (exec.name !== FIELD_TOOL_NAME) return
    const result = { ...pick(value, ['host', 'operation', 'outcome', 'message', 'backendFenced', 'cleanupWarning']),
      ...(value.error ? { error: pick(value.error, ['code', 'message']) } : {}) }
    const state = records(exec.agent)
    const item = state?.get(exec.callId)
    // Uncertainty wins even if a later normalization retained a confirmed value.
    if (item?.result?.outcome === 'uncertain') return
    if (item) { item.result = result; item.phase = value.outcome }
    else store(exec, { result, phase: value.outcome })
  }
  function phase(exec, value) {
    const item = records(exec.agent)?.get(exec.callId)
    if (item) item.phase = value
    else if (exec.name === GRANT_TOOL_NAME) store(exec, { phase: value })
  }
  function granted(exec, grant) {
    const item = records(exec.agent)?.get(exec.callId)
    if (item) { item.grantId = grant.id; item.phase = 'active' }
  }
  function resolve(input) {
    if (!input || typeof input.sessionId !== 'string' || typeof input.callId !== 'string') throw new Error('Invalid GitHub presentation target.')
    const agent = agents?.get(input.sessionId)
    if (!live(agent)) return undefined
    return agent
  }
  function approvalPhase(session, callId, toolName) {
    // Read only the required audit leaves; never serialize a live Session.
    const decisions = new Map()
    for (let seq = session.seq - 1, count = 0; seq >= 0 && count < 2000; seq--, count++) {
      const event = session.eventAt(seq)
      if (event?.type === 'approval/decided') decisions.set(event.data.id, event.data.outcome)
      if (event?.type === 'approval/asked' && event.data.callId === callId && event.data.toolName === toolName) {
        const outcome = decisions.get(event.data.id)
        return outcome === undefined ? 'awaiting-approval' : outcome === 'allowed-once' ? 'approved' : outcome === 'rejected' ? 'denied' : 'unattempted'
      }
    }
  }
  function status(input) {
    const agent = resolve(input)
    if (!agent) return { version: 1, phase: 'expired', grants: [], history: [] }
    const exec = caller({ agent })
    const entry = sessions.get(agent.session)?.get(input.callId)
    const result = entry ? { ...entry } : { version: 1, phase: 'expired' }
    if (entry && ['prepared', 'authorized-by-grant', 'unattempted'].includes(entry.phase)) {
      const auditPhase = approvalPhase(agent.session, input.callId, entry.toolName)
      if (entry.phase !== 'unattempted' || auditPhase === 'denied') result.phase = auditPhase ?? entry.phase
    }
    const root = exec.isSubagent === false
    result.grants = root ? grants.list(exec) : []
    result.history = root ? grants.history(exec) : []
    result.historyTruncated = root ? grants.historyTruncated?.(exec) ?? false : false
    if (result.toolName === GRANT_TOOL_NAME && result.phase === 'active') {
      if (result.grantId) result.phase = result.grants.find(g => g.id === result.grantId)?.state ?? 'expired'
      else if (!result.grants.some(g => g.state === 'active')) result.phase = 'expired'
    }
    return result
  }
  function revoke(input) {
    const agent = resolve(input)
    if (!agent) throw new Error('GitHub session expired.')
    grants.revoke(input.grantId, caller({ agent }))
    return status(input)
  }
  function disposeSession(session) { sessions.delete(session) }
  function dispose() { active = false; sessions.clear() }
  return Object.freeze({ request, granted, prepared, settled, phase, status, revoke, disposeSession, dispose })
}
