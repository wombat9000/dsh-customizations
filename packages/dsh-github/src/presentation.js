import { GRANT_TOOL_NAME } from './grant-tools.js'

// Presentation data never confers authority. Opaque grant/write tokens remain
// private to their runtimes. Eviction/restoration deliberately loses previews.
export function createGitHubPresentation({ agents, grants, caller }) {
  const sessions = new Map()
  let active = true
  function live(agent) { return active && !!agent?.session && agents?.get(agent.session.id) === agent && agents.roots().includes(agent) }
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
    if (entry && ['prepared', 'unattempted'].includes(entry.phase)) result.phase = approvalPhase(agent.session, input.callId, entry.toolName) ?? entry.phase
    result.grants = grants.list(exec)
    result.history = grants.history(exec)
    result.historyTruncated = grants.historyTruncated?.(exec) ?? false
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
  return Object.freeze({ request, granted, phase, status, revoke, disposeSession, dispose })
}
