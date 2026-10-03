import type { ToolBlock, ToolChatData, TurnLocation } from '../shared/contracts.ts'
import { object, text, safeUrl, id } from './validation.ts'
import { READ_TOOLS, readCardModel } from './read-models.ts'
import { PR_TOOLS, PR_TOOL_TITLES, pullRequestCardModel } from './pull-request-model.ts'
import { fieldResult, fieldValueModel } from './field-model.ts'
import { validScope } from './grant-model.ts'
import { inspectCollections, supplied } from './collection-completeness.ts'

const readNames = new Set([
  ...READ_TOOLS,
  ...PR_TOOLS.filter((name) => /^github_(get|list)_/.test(name)),
  'github_connection_status',
  'github_detect_repositories',
  'github_list_repositories',
  'github_get_repository',
  'github_get_issue_comments',
])
const writeTitles: Readonly<Record<string, string>> = {
  github_create_project: 'Create project',
  github_update_project: 'Update project',
  github_link_project_repository: 'Link repository to project',
  github_create_issue: 'Create issue',
  github_add_project_item: 'Add project item',
  github_set_project_item_field: 'Set project field',
  github_add_issue_dependency: 'Add blocking dependency',
  ...Object.fromEntries(Object.entries(PR_TOOL_TITLES).filter(([name]) => !readNames.has(name))),
}
export type ActivityOutcome =
  'inspected' | 'confirmed' | 'no-change' | 'denied' | 'failed' | 'uncertain'
export interface ActivityAction {
  label: string
  mode: 'read' | 'write' | 'access' | 'unknown'
  outcome: ActivityOutcome
  count: number
}
export interface ActivityResource {
  key: string
  label: string
  url?: string
  actions: ActivityAction[]
}
export interface ActivityModel {
  resources: ActivityResource[]
  calls: number
  warnings: string[]
  summary: string[]
}
const positive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0
const segment = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[A-Za-z0-9_.-]{1,100}$/.test(value) &&
  value !== '.' &&
  value !== '..'
function parseArgs(block: ToolBlock): Record<string, unknown> {
  try {
    const raw = block.call?.argsRaw ?? block.argsRaw
    if (typeof raw !== 'string' || raw.length > 65536) return {}
    const value: unknown = JSON.parse(raw)
    return object(value) ? value : {}
  } catch {
    return {}
  }
}
function envelope(block: ToolBlock): Record<string, unknown> | undefined {
  if (block.kind !== 'tool-result') return undefined
  const parts = Array.isArray(block.content)
    ? block.content.filter((part) => object(part) && part.type === 'text')
    : undefined
  const raw = parts?.[0]?.text
  if (parts?.length !== 1 || typeof raw !== 'string' || raw.length > 524288) return undefined
  try {
    const value: unknown = JSON.parse(raw)
    return object(value) && value.host === 'github.com' ? value : undefined
  } catch {
    return undefined
  }
}
// Canonical links are identities, never evidence that a mutation succeeded.
function linkedResource(value: unknown): Omit<ActivityResource, 'actions'> | undefined {
  const url = typeof value === 'string' && value.length <= 4096 ? safeUrl(value) : undefined
  if (!url) return undefined
  const path = new URL(url).pathname
  const item = path.match(/^\/([^/]+)\/([^/]+)\/(pull|issues)\/([1-9]\d*)(?:\/.*)?$/)
  if (item) {
    const label = `${item[1]}/${item[2]} ${item[3] === 'pull' ? 'PR' : 'issue'} #${item[4]}`
    const canonical = `https://github.com/${item[1]}/${item[2]}/${item[3]}/${item[4]}`
    return { key: canonical.toLowerCase(), label, url: canonical }
  }
  const project = path.match(/^\/(orgs|users)\/([^/]+)\/projects\/([1-9]\d*)(?:\/.*)?$/)
  if (project)
    return {
      key: `project:${project[2]?.toLowerCase()}:${project[3]}`,
      label: `${project[2]} project #${project[3]}`,
      url: `https://github.com/${project[1]}/${project[2]}/projects/${project[3]}`,
    }
  return undefined
}
function resourceFor(
  name: string,
  args: Record<string, unknown>,
  result: Record<string, unknown> | undefined,
  callId: string,
): Omit<ActivityResource, 'actions'> {
  const repo = segment(args.owner) && segment(args.repo) ? `${args.owner}/${args.repo}` : ''
  // Project operations use owner for the board; repositoryOwner identifies an
  // issue being added. Their primary resource remains the project, not an issue
  // assembled from mismatched owner/repository arguments.
  const isProject = name.includes('project')
  if (!isProject && repo && name !== 'github_list_pull_requests' && positive(args.pullNumber))
    return linkedResource(`https://github.com/${repo}/pull/${args.pullNumber}`)!
  if (!isProject && repo && positive(args.issueNumber))
    return linkedResource(`https://github.com/${repo}/issues/${args.issueNumber}`)!
  // Only singular supplied identities belong here. Listing results stay at repo/owner scope.
  const data = supplied(result, 'data'),
    resource = supplied(result, 'resource')
  const targets = supplied(result, 'knownTargets')
  const candidates = isProject
    ? [
        supplied(resource, 'project'),
        resource,
        supplied(targets, 'project'),
        name === 'github_get_project' ? data : undefined,
      ]
    : [
        supplied(data, 'pullRequest'),
        resource,
        supplied(resource, 'issue'),
        supplied(targets, 'issue'),
        supplied(targets, 'blockedIssue'),
        supplied(targets, 'pullRequest'),
        name === 'github_get_issue' ? data : undefined,
      ]
  for (const candidate of candidates) {
    const linked = linkedResource(supplied(candidate, 'url'))
    if (linked) return linked
  }
  if (segment(args.owner) && positive(args.projectNumber))
    return {
      key: `project:${args.owner.toLowerCase()}:${args.projectNumber}`,
      label: `${args.owner} project #${args.projectNumber}`,
    }
  if (repo)
    return { key: `repo:${repo.toLowerCase()}`, label: repo, url: `https://github.com/${repo}` }
  if (segment(args.owner))
    return {
      key: `owner:${args.owner.toLowerCase()}`,
      label: `${args.owner} · owner scope`,
      url: `https://github.com/${args.owner}`,
    }
  if (name === 'github_connection_status' || name === 'github_detect_repositories')
    return { key: 'connection', label: 'GitHub connection / workspace' }
  if (name === 'github_search_issues') return { key: 'search', label: 'GitHub issue search' }
  if (name === 'github_request_issue_management')
    return { key: 'access', label: 'Session issue-management access' }
  // Never merge unidentified mutations just because their titles match.
  return { key: `unknown:${callId}`, label: 'GitHub resource not identified' }
}
// Validate the consumed identity shape for each existing write output. An id on
// an unrelated nested object is not enough to establish a successful mutation.
function confirmedWrite(name: string, block: ToolBlock, result: Record<string, unknown>): boolean {
  if (PR_TOOLS.includes(name)) return pullRequestCardModel(name, block).status === 'Confirmed'
  const resource = result.resource
  if (!object(resource)) return false
  const entity = (value: unknown) => object(value) && id(value.id) && !!safeUrl(value.url)
  switch (name) {
    case 'github_create_project':
    case 'github_update_project':
      return (
        result.operation ===
          (name === 'github_create_project' ? 'createProject' : 'updateProject') &&
        entity(resource) &&
        positive(resource.number) &&
        typeof resource.title === 'string' &&
        linkedResource(resource.url)?.key.startsWith('project:') === true
      )
    case 'github_create_issue':
      return (
        result.operation === 'createIssue' &&
        entity(resource) &&
        positive(resource.number) &&
        typeof resource.title === 'string' &&
        /\/issues\//.test(text(resource.url))
      )
    case 'github_link_project_repository':
      return (
        result.operation === 'linkProjectRepository' &&
        entity(resource.repository) &&
        entity(resource.project) &&
        linkedResource(supplied(resource.project, 'url'))?.key.startsWith('project:') === true
      )
    case 'github_add_project_item':
    case 'github_set_project_item_field':
      return (
        result.operation ===
          (name === 'github_add_project_item' ? 'addProjectItem' : 'setProjectItemField') &&
        id(resource.id) &&
        entity(resource.project) &&
        linkedResource(supplied(resource.project, 'url'))?.key.startsWith('project:') === true &&
        (name !== 'github_add_project_item' || id(supplied(resource.content, 'id')))
      )
    case 'github_add_issue_dependency':
      return (
        result.operation === 'addIssueDependency' &&
        entity(resource.issue) &&
        entity(resource.blockingIssue)
      )
    default:
      return false
  }
}
function inspectedRead(name: string, block: ToolBlock, data: Record<string, unknown>): boolean {
  if (READ_TOOLS.includes(name)) return readCardModel(name, block).state === 'returned'
  if (PR_TOOLS.includes(name)) return !pullRequestCardModel(name, block).error
  switch (name) {
    case 'github_connection_status':
      return (
        typeof data.cliAvailable === 'boolean' &&
        (typeof data.authenticated === 'boolean' || data.authenticated === 'unknown')
      )
    case 'github_detect_repositories':
      return (
        typeof data.gitRepository === 'boolean' &&
        Array.isArray(data.candidates) &&
        data.candidates.every(
          (candidate) =>
            object(candidate) &&
            segment(candidate.owner) &&
            segment(candidate.repo) &&
            candidate.nameWithOwner === `${candidate.owner}/${candidate.repo}` &&
            safeUrl(candidate.url) === `https://github.com/${candidate.owner}/${candidate.repo}`,
        ) &&
        typeof data.ambiguous === 'boolean'
      )
    case 'github_get_repository':
      return id(data.id) && typeof data.nameWithOwner === 'string' && !!safeUrl(data.url)
    case 'github_list_repositories':
      return (
        Array.isArray(data.nodes) &&
        data.nodes.every(
          (entry) =>
            object(entry) &&
            id(entry.id) &&
            typeof entry.nameWithOwner === 'string' &&
            !!safeUrl(entry.url),
        ) &&
        object(data.pageInfo)
      )
    case 'github_get_issue_comments':
      return (
        Array.isArray(data.nodes) &&
        data.nodes.every(
          (entry) =>
            object(entry) && id(entry.id) && typeof entry.body === 'string' && !!safeUrl(entry.url),
        ) &&
        object(data.pageInfo)
      )
    default:
      return false
  }
}
function actionFor(
  name: string,
  block: ToolBlock,
  result: Record<string, unknown> | undefined,
): ActivityAction {
  const mode = readNames.has(name)
    ? 'read'
    : Object.hasOwn(writeTitles, name)
      ? 'write'
      : name === 'github_request_issue_management'
        ? 'access'
        : 'unknown'
  let label =
    writeTitles[name] ??
    PR_TOOL_TITLES[name as keyof typeof PR_TOOL_TITLES] ??
    name.replace(/^github_/, '').replaceAll('_', ' ')
  let outcome: ActivityOutcome = 'uncertain'
  const raw =
    Array.isArray(block.content) && block.content.length === 1 ? text(block.content[0]?.text) : ''
  // RC2's native approval seam emits these exact denial texts (no durable denial code).
  const denied =
    block.isError === true &&
    [
      `Error: the user rejected tool "${name}"`,
      `Error: tool "${name}" requires approval, but no approval channel is available`,
      `Error: tool "${name}" requires approval, but the call has no agent to route it through`,
    ].includes(raw)
  if (result?.outcome === 'uncertain') outcome = 'uncertain'
  else if (
    denied ||
    block.error?.code === 'ABORTED_BEFORE_DISPATCH' ||
    block.error?.code === 'TOOL_NOT_STARTED'
  )
    outcome = 'denied'
  else if (object(result?.error) || result?.outcome === 'failed') outcome = 'failed'
  else if (block.isError === true) outcome = mode === 'write' ? 'uncertain' : 'failed'
  else if (
    mode === 'read' &&
    result?.untrusted === true &&
    object(result.data) &&
    Object.keys(result.data).length > 0
  ) {
    outcome = inspectedRead(name, block, result.data) ? 'inspected' : 'uncertain'
  } else if (
    mode === 'write' &&
    result?.untrusted === true &&
    result.outcome === 'confirmed' &&
    confirmedWrite(name, block, result)
  ) {
    outcome = 'confirmed'
  } else if (
    name === 'github_set_project_item_field' &&
    fieldResult(block)?.outcome === 'no-change'
  )
    outcome = 'no-change'
  else if (
    mode === 'access' &&
    result?.untrusted === true &&
    result.outcome === 'granted' &&
    object(result.grant) &&
    id(result.grant.id) &&
    result.grant.state === 'active' &&
    validScope(result.grant.scope)
  )
    outcome = 'confirmed'
  if (block.isError === true && mode === 'write' && outcome === 'uncertain')
    label += ' · tool reported an error'
  if (name === 'github_set_project_item_field') {
    const args = parseArgs(block)
    if (typeof args.itemId === 'string') label += ` · item ${args.itemId.slice(0, 80)}`
    if (typeof args.fieldId === 'string') label += ` · field ${args.fieldId.slice(0, 80)}`
  }
  if (name === 'github_set_project_item_field' && object(result?.change)) {
    const before = fieldValueModel(result.change, 'before'),
      after = fieldValueModel(result.change, 'after')
    const field = text(supplied(result.change.field, 'name'))
    if (before.available && after.available)
      label += ` · ${field || 'field'}: ${before.label} → ${after.label}`
  }
  if (outcome === 'confirmed' && name === 'github_update_pull_request') {
    const after = supplied(result?.change, 'after')
    if (object(after)) {
      const changes = ['title', 'body'].filter((key) => Object.hasOwn(after, key))
      if (typeof after.draft === 'boolean') changes.push(after.draft ? 'draft' : 'ready for review')
      if (changes.length) label += ` · ${changes.join(', ')}`
    }
  }
  if (outcome === 'confirmed' && name === 'github_submit_pull_request_review') {
    const state = text(supplied(result?.resource, 'state'))
    const sha = text(supplied(result?.resource, 'commitSha')).slice(0, 12)
    label += ` · ${state} · commit ${sha}`
  }
  if (block.kind !== 'tool-result') label += ' · no result recorded; execution unconfirmed'
  // Access approval is not a GitHub mutation, and historical grants are not live authority.
  if (mode === 'access') label = 'Request session access (historical, not current authority)'
  return { label: label.slice(0, 240), mode, outcome, count: 1 }
}

/** One bounded, historical projection. No transport, clocks, or recovery state. */
export function githubActivityModel(
  data: readonly ToolChatData[],
  turn: TurnLocation,
): ActivityModel | null {
  if (turn.status !== 'closed') return null
  const resources = new Map<string, ActivityResource>(),
    warnings = new Set<string>()
  const counts = new Map<string, number>()
  const seenObjects = new Set<object>(),
    seenCalls = new Set<string>()
  if (data.length > 5000)
    warnings.add('Overview inspection limit reached; additional calls remain in tool details.')
  const pending: unknown[] = data
    .slice(0, 5000)
    .map((value) => value.root)
    .toReversed()
  let budget = 5000,
    calls = 0
  while (pending.length && budget-- > 0) {
    const candidate = pending.pop()
    if (!object(candidate) || seenObjects.has(candidate)) continue
    seenObjects.add(candidate)
    if (Array.isArray(candidate.subCalls)) {
      // Bound traversal storage as well as work; excess stays in native details.
      const available = Math.max(0, 5000 - pending.length)
      if (candidate.subCalls.length > available)
        warnings.add('Overview inspection limit reached; additional calls remain in tool details.')
      pending.push(...candidate.subCalls.slice(0, available).toReversed())
    }
    const block: ToolBlock = {
      kind: text(candidate.kind),
      argsRaw: typeof candidate.argsRaw === 'string' ? candidate.argsRaw : undefined,
      call: {
        argsRaw:
          typeof supplied(candidate.call, 'argsRaw') === 'string'
            ? text(supplied(candidate.call, 'argsRaw'))
            : undefined,
      },
      content: Array.isArray(candidate.content)
        ? candidate.content.map((part: unknown) =>
            object(part) ? { type: text(part.type), text: part.text } : {},
          )
        : undefined,
      isError: candidate.isError === true,
      error: object(candidate.error)
        ? { name: candidate.error.name, code: candidate.error.code }
        : undefined,
    }
    const result = envelope(block)
    const name = text(supplied(candidate.call, 'name')) || text(candidate.name)
    if (!name.startsWith('github_') && !result) continue
    const callId = text(candidate.callId)
    if (callId && seenCalls.has(callId)) continue
    if (callId) seenCalls.add(callId)
    else warnings.add('Some calls lack identity; deduplication is incomplete.')
    calls++
    const resource = resourceFor(name, parseArgs(block), result, callId || `missing-${calls}`)
    const action = actionFor(name, block, result)
    const outcomeLabel =
      action.outcome === 'inspected'
        ? 'read-only inspections'
        : action.outcome === 'confirmed'
          ? action.mode === 'write'
            ? 'confirmed writes'
            : 'historical access approvals'
          : action.outcome === 'no-change'
            ? 'no-change results'
            : `${action.outcome} outcomes`
    counts.set(outcomeLabel, (counts.get(outcomeLabel) ?? 0) + 1)
    if (!name)
      warnings.add(
        'A GitHub result has no loaded call head; operation and target may be unavailable.',
      )
    if (action.outcome === 'uncertain')
      warnings.add(
        'Some outcomes are uncertain or unavailable. A later read does not confirm an earlier write; inspect GitHub before retrying.',
      )
    if (action.mode === 'read' && result) {
      const inspection = inspectCollections(result, name)
      if (
        inspection.completeness !== 'complete' ||
        (READ_TOOLS.includes(name) && readCardModel(name, block).completeness !== 'complete') ||
        inspection.notices.length ||
        (PR_TOOLS.includes(name) && pullRequestCardModel(name, block).warnings.length)
      ) {
        warnings.add(
          'Read coverage is partial or unknown. Inspect individual tool details for pagination, truncation, and evidence limits.',
        )
      }
    }
    let group = resources.get(resource.key)
    if (!group) {
      if (resources.size >= 100) {
        warnings.add(
          'Only 100 resource groups are summarized; additional calls remain in tool details.',
        )
        continue
      }
      group = { ...resource, actions: [] }
      resources.set(resource.key, group)
    }
    if (!group.url && resource.url) group.url = resource.url
    const existing = group.actions.find(
      (value) =>
        value.label === action.label &&
        value.mode === action.mode &&
        value.outcome === action.outcome,
    )
    if (existing) existing.count++
    else if (group.actions.length < 40) group.actions.push(action)
    else
      warnings.add('Some resource actions exceed the compact summary limit; inspect tool details.')
  }
  if (!calls) return null
  if (pending.length)
    warnings.add('Overview inspection limit reached; additional calls remain in tool details.')
  if (!turn.start || !turn.end)
    warnings.add(
      'Partial history window: the full turn is not loaded. Only available GitHub evidence is summarized.',
    )
  // Keep warnings bounded, without silently claiming that omitted notices are absent.
  const important = (warning: string) =>
    /Partial history|Some outcomes|inspection limit|Only 100|lack identity|no loaded call head/.test(
      warning,
    )
  const allWarnings = [...warnings].sort((a, b) => Number(important(b)) - Number(important(a)))
  return {
    resources: [...resources.values()],
    calls,
    summary: [...counts].map(([label, count]) => `${count} ${label}`),
    warnings:
      allWarnings.length > 8
        ? [...allWarnings.slice(0, 7), 'Additional completeness warnings remain in tool details.']
        : allWarnings,
  }
}
