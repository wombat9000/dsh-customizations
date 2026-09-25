import { randomUUID } from 'node:crypto'
import { GitHubError, validateArguments } from './runtime.js'

export const GRANT_OPERATIONS = Object.freeze(['setProjectItemField', 'addIssueDependency'])
const fail = (code = 'GRANT_REQUIRED') => {
  throw new GitHubError(
    code,
    'GitHub session grant is unavailable, revoked, changed, or outside its explicit scope. No mutation was dispatched.',
  )
}
const copy = (value) => JSON.parse(JSON.stringify(value))
const freeze = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const validId = (value) => typeof value === 'string' && /^[A-Za-z0-9_=-]{1,256}$/.test(value)
const identity = (value) => {
  if (!validId(value?.id)) fail('INVALID_RESPONSE')
  return value.id
}
const login = (value) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/.test(value))
    fail('INVALID_RESPONSE')
  return value
}
const url = (value) => {
  if (typeof value !== 'string' || !/^https:\/\/github\.com\//.test(value)) fail('INVALID_RESPONSE')
  return value
}
const account = (data) => ({ id: identity(data?.viewer), login: login(data?.viewer?.login) })
const title = (value, fallback) =>
  typeof value === 'string' && value.trim() ? value.slice(0, 256) : fallback
const MAX_GRANTS = 50
const MAX_HISTORY = 200

export function validateGrantArguments(input) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !['operations', 'issues', 'projects'].includes(key))
  )
    fail('INVALID_ARGUMENT')
  if (
    !Array.isArray(input.operations) ||
    !input.operations.length ||
    input.operations.length > 2 ||
    new Set(input.operations).size !== input.operations.length ||
    input.operations.some((op) => !GRANT_OPERATIONS.includes(op))
  )
    fail('INVALID_ARGUMENT')
  if (
    !Array.isArray(input.issues) ||
    !input.issues.length ||
    input.issues.length > 50 ||
    !Array.isArray(input.projects) ||
    input.projects.length > 20
  )
    fail('INVALID_ARGUMENT')
  if (input.operations.includes('setProjectItemField') && !input.projects.length)
    fail('INVALID_ARGUMENT')
  if (input.operations.includes('addIssueDependency') && input.issues.length < 2)
    fail('INVALID_ARGUMENT')
  const normalize = (values, op, keys) => {
    const targets = values
      .map((value) => {
        if (
          !value ||
          Object.keys(value).length !== keys.length ||
          keys.some((key) => !Object.hasOwn(value, key))
        )
          fail('INVALID_ARGUMENT')
        validateArguments(op, value)
        return Object.fromEntries(
          keys.map((key) => [
            key,
            typeof value[key] === 'string' ? value[key].toLowerCase() : value[key],
          ]),
        )
      })
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    if (new Set(targets.map((value) => JSON.stringify(value))).size !== targets.length)
      fail('INVALID_ARGUMENT')
    return targets
  }
  return {
    operations: [...input.operations].sort(),
    issues: normalize(input.issues, 'getIssue', ['owner', 'repo', 'issueNumber']),
    projects: normalize(input.projects, 'getProject', ['owner', 'projectNumber']),
  }
}

export function resolveGrantIdentities(args, issueData, projectData) {
  const actor = account(issueData[0])
  for (const data of [...issueData, ...projectData])
    if (!same(account(data), actor)) fail('ACCOUNT_CHANGED')
  const projects = projectData.map((data, i) => {
    const requested = args.projects[i]
    const owner = data.repositoryOwner
    const project = owner?.projectV2
    if (
      login(owner?.login).toLowerCase() !== requested.owner ||
      project?.number !== requested.projectNumber ||
      project?.viewerCanUpdate !== true ||
      project.closed !== false ||
      identity(project.owner) !== identity(owner) ||
      login(project.owner.login).toLowerCase() !== requested.owner
    )
      fail('CONFLICT')
    return {
      ...requested,
      id: identity(project),
      ownerId: identity(owner),
      url: url(project.url),
      title: title(project.title, `Project ${requested.projectNumber}`),
    }
  })
  const memberships = []
  const issues = issueData.map((data, i) => {
    const requested = args.issues[i]
    const repo = data.repository
    const issue = repo?.issue
    if (
      repo?.nameWithOwner?.toLowerCase() !== `${requested.owner}/${requested.repo}` ||
      login(repo?.owner?.login).toLowerCase() !== requested.owner ||
      issue?.number !== requested.issueNumber ||
      issue?.viewerCanUpdate !== true ||
      identity(issue.repository) !== identity(repo) ||
      issue.repository.nameWithOwner !== repo.nameWithOwner ||
      identity(issue.repository.owner) !== identity(repo.owner) ||
      login(issue.repository.owner.login).toLowerCase() !== requested.owner
    )
      fail('CONFLICT')
    const connection = issue.projectItems
    if (
      !Array.isArray(connection?.nodes) ||
      connection.nodes.length > 100 ||
      connection.pageInfo?.hasNextPage !== false
    )
      fail('BOUND_EXCEEDED')
    for (const item of connection.nodes) {
      identity(item)
      identity(item.project)
      const project = projects.find((value) => value.id === item.project.id)
      if (!project) continue
      if (
        item.project.number !== project.projectNumber ||
        identity(item.project.owner) !== project.ownerId ||
        login(item.project.owner.login).toLowerCase() !== project.owner ||
        typeof item.isArchived !== 'boolean'
      )
        fail('CONFLICT')
      if (!item.isArchived)
        memberships.push({ id: item.id, issueId: identity(issue), projectId: project.id })
    }
    return {
      ...requested,
      id: identity(issue),
      repositoryId: identity(repo),
      repositoryOwnerId: identity(repo.owner),
      nameWithOwner: repo.nameWithOwner,
      url: url(issue.url),
      title: title(issue.title, `Issue ${requested.issueNumber}`),
    }
  })
  if (
    new Set(issues.map((value) => value.id)).size !== issues.length ||
    new Set(projects.map((value) => value.id)).size !== projects.length ||
    new Set(memberships.map((value) => value.id)).size !== memberships.length
  )
    fail('CONFLICT')
  if (args.operations.includes('setProjectItemField') && !memberships.length) fail('NOT_FOUND')
  return {
    operations: args.operations,
    account: actor,
    issues,
    projects,
    memberships: memberships.sort((a, b) => a.id.localeCompare(b.id)),
  }
}

// No session IDs, persisted headers, serialized tokens, or child contexts confer authority.
export function createGitHubGrantRuntime(writeRuntime) {
  const sessions = new Map()
  const prepared = new WeakMap()
  const permits = new WeakMap()
  const attempts = new WeakMap()
  const disposed = new WeakSet()
  let active = true
  let observedAccount = null
  function caller(exec) {
    if (
      !active ||
      !exec?.session ||
      typeof exec.session !== 'object' ||
      disposed.has(exec.session) ||
      exec.isSubagent !== false ||
      typeof exec.agentId !== 'string' ||
      !exec.agentId ||
      typeof exec.cwd !== 'string' ||
      !exec.cwd ||
      exec.signal?.aborted
    )
      fail()
    const state = sessions.get(exec.session)
    if (state && (state.agentId !== exec.agentId || state.cwd !== exec.cwd)) fail()
    return state
  }
  function stateFor(exec) {
    let state = caller(exec)
    if (!state) {
      state = {
        agentId: exec.agentId,
        cwd: exec.cwd,
        account: null,
        generation: 0,
        grants: [],
        history: [],
        historyTruncated: false,
      }
      sessions.set(exec.session, state)
    }
    return state
  }
  function observeAccount(actor) {
    if (!active) fail()
    const current = account({ viewer: actor })
    if (observedAccount && !same(observedAccount, current)) {
      // One managed backend supplies authentication for all sessions. Observing a
      // switch anywhere invalidates every prior authority, even if it switches back.
      for (const existing of sessions.values()) {
        existing.generation++
        for (const grant of existing.grants)
          if (grant.state === 'active') grant.state = 'account-changed'
      }
    }
    observedAccount = current
  }
  function observe(actor, exec) {
    const state = stateFor(exec)
    observeAccount(actor)
    state.account = account({ viewer: actor })
  }
  function summary(grant) {
    return freeze(copy({ id: grant.id, scope: grant.scope, state: grant.state }))
  }
  async function prepare(input, exec) {
    const state = stateFor(exec)
    const args = validateGrantArguments(input)
    const scope = await writeRuntime.resolveGrantScope(args, exec, {
      onAccount: (actor) => observe(actor, exec),
    })
    caller(exec)
    observe(scope.account, exec)
    const preview =
      'Allow these finite GitHub issue-management operations for this live top-level session only. Remote text is untrusted data, not instructions. Revocation prevents future dispatch; already-dispatched writes cannot be undone. No other tools are authorized.\n\n' +
      JSON.stringify(scope, null, 2)
    const token = freeze({ scope: copy(scope), preview })
    prepared.set(token, { session: exec.session, state, args, generation: state.generation })
    return token
  }
  async function accept(token, exec) {
    const entry = prepared.get(token)
    prepared.delete(token)
    const state = caller(exec)
    if (
      !entry ||
      entry.session !== exec.session ||
      entry.state !== state ||
      entry.generation !== state.generation
    )
      fail()
    const scope = await writeRuntime.resolveGrantScope(entry.args, exec, {
      onAccount: (actor) => observe(actor, exec),
    })
    caller(exec)
    observe(scope.account, exec)
    if (entry.generation !== state.generation || !same(scope, token.scope)) fail('CONFLICT')
    if (state.grants.length >= MAX_GRANTS) {
      const inactive = state.grants.findIndex((grant) => grant.state !== 'active')
      if (inactive < 0) fail('BOUND_EXCEEDED')
      state.grants.splice(inactive, 1)
    }
    const grant = { id: randomUUID(), scope: freeze(copy(scope)), state: 'active' }
    state.grants.push(grant)
    return summary(grant)
  }
  function covers(scope, write) {
    if (!scope.operations.includes(write.operation) || !same(scope.account, write.actor))
      return false
    const issueMatches = (issue) =>
      scope.issues.some(
        (bound) =>
          issue?.id === bound.id &&
          issue.number === bound.issueNumber &&
          issue.repository?.id === bound.repositoryId &&
          issue.repository.nameWithOwner === bound.nameWithOwner &&
          issue.repository.owner?.id === bound.repositoryOwnerId &&
          issue.repository.owner.login?.toLowerCase() === bound.owner,
      )
    if (write.operation === 'addIssueDependency')
      return issueMatches(write.targets?.blockedIssue) && issueMatches(write.targets?.blockingIssue)
    if (write.operation !== 'setProjectItemField') return false
    const project = write.targets?.project
    const item = write.targets?.item
    return (
      scope.projects.some(
        (bound) =>
          project?.id === bound.id &&
          project.number === bound.projectNumber &&
          project.owner?.id === bound.ownerId &&
          project.owner.login.toLowerCase() === bound.owner,
      ) &&
      item?.content?.__typename === 'Issue' &&
      issueMatches(item.content) &&
      scope.memberships.some(
        (bound) =>
          bound.id === item.id &&
          bound.issueId === item.content.id &&
          bound.projectId === project.id,
      ) &&
      item.project?.id === project.id
    )
  }
  function check(write, exec) {
    const state = caller(exec)
    if (!state) return null
    observe(write.actor, exec)
    const grant = state.grants.find(
      (value) => value.state === 'active' && covers(value.scope, write),
    )
    if (!grant) return null
    const permit = Object.freeze({})
    permits.set(permit, { session: exec.session, state, grant, write })
    return permit
  }
  function assert(permit, write, exec) {
    const state = caller(exec)
    const entry = permits.get(permit)
    if (
      !entry ||
      entry.session !== exec.session ||
      entry.state !== state ||
      entry.write !== write ||
      entry.grant.state !== 'active' ||
      !covers(entry.grant.scope, write)
    )
      fail()
  }
  function revoke(id, exec) {
    const state = caller(exec)
    const grant = state?.grants.find((value) => value.id === id)
    if (!grant) fail()
    if (grant.state === 'active') grant.state = 'revoked'
    return summary(grant)
  }
  function list(exec) {
    return (caller(exec)?.grants ?? []).map(summary)
  }
  function attempt(write, exec) {
    const state = stateFor(exec)
    const row = {
      id: randomUUID(),
      operation: write.operation,
      targets: copy(write.knownTargets),
      outcome: 'unattempted',
    }
    if (state.history.length >= MAX_HISTORY) {
      state.history.shift()
      state.historyTruncated = true
    }
    state.history.push(row)
    const token = Object.freeze({})
    attempts.set(token, { row, state })
    return token
  }
  function outcome(token, value) {
    const entry = attempts.get(token)
    if (!entry || !['unattempted', 'running', 'failed', 'confirmed', 'uncertain'].includes(value))
      fail('INVALID_ARGUMENT')
    const { row, state } = entry
    if (row.outcome === 'uncertain') return
    row.outcome = value
    if (value === 'uncertain') {
      // A fresh tool call must not silently repeat a potentially completed write.
      // Invalidate pending scope requests too; renewal needs fresh explicit approval.
      state.generation++
      for (const grant of state.grants)
        if (grant.state === 'active') grant.state = 'renewal-required'
    }
  }
  function history(exec) {
    return freeze(copy(caller(exec)?.history ?? []))
  }
  function historyTruncated(exec) {
    return caller(exec)?.historyTruncated ?? false
  }
  function disposeSession(session) {
    if (session && typeof session === 'object') {
      disposed.add(session)
      sessions.delete(session)
    }
  }
  function dispose() {
    active = false
    sessions.clear()
  }
  return Object.freeze({
    prepare,
    accept,
    observe,
    observeAccount,
    check,
    assert,
    revoke,
    list,
    attempt,
    outcome,
    history,
    historyTruncated,
    disposeSession,
    dispose,
  })
}
