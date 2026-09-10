import { text } from './projections.js'

function folded(value) {
  return String(value).toLocaleLowerCase('en-US')
}

function isUuid(value) {
  return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value)
}

function idBranch(value) {
  return isUuid(value) ? [{ id: { eq: value } }] : []
}

function choose(kind, wanted, candidates, matches) {
  if (matches.length === 1) return matches[0]
  if (matches.length === 0) throw new Error(`Linear ${kind} not found: ${wanted}`)
  const names = matches.slice(0, 5).map((item) => item.name ?? item.key ?? item.id).join(', ')
  throw new Error(`Linear ${kind} is ambiguous: ${wanted}. Matches: ${names}`)
}

function exact(kind, selector, candidates, fields) {
  const wanted = text(selector)
  if (wanted === undefined) throw new Error(`Linear ${kind} must be a non-empty selector.`)
  const lower = folded(wanted)
  const matches = candidates.filter((candidate) => fields.some((field) => {
    const value = candidate[field]
    return (typeof value === 'string' || typeof value === 'number')
      && (String(value) === wanted || folded(value) === lower)
  }))
  return choose(kind, wanted, candidates, matches)
}

export async function resolveTeam(client, selector) {
  const wanted = text(selector)
  if (wanted === undefined) throw new Error('Linear team must be a non-empty ID, key, or exact name.')
  const result = await client.teams({
    first: 20,
    filter: {
      or: [
        ...idBranch(wanted),
        { key: { eqIgnoreCase: wanted } },
        { name: { eqIgnoreCase: wanted } },
      ],
    },
  })
  return exact('team', wanted, result.nodes, ['id', 'key', 'name'])
}

export async function resolveUser(client, selector) {
  const wanted = text(selector)
  if (wanted === undefined) throw new Error('Linear user must be a non-empty ID, email, or exact name.')
  if (folded(wanted) === 'me') return client.viewer
  const result = await client.users({
    first: 20,
    includeDisabled: true,
    filter: {
      or: [
        ...idBranch(wanted),
        { email: { eqIgnoreCase: wanted } },
        { name: { eqIgnoreCase: wanted } },
        { displayName: { eqIgnoreCase: wanted } },
      ],
    },
  })
  return exact('user', wanted, result.nodes, ['id', 'email', 'name', 'displayName'])
}

export async function resolveStates(client, selectors, team) {
  if (!Array.isArray(selectors) || selectors.length === 0) return []
  const wanted = selectors.map(text)
  if (wanted.some((value) => value === undefined)) throw new Error('Linear states must be non-empty IDs, types, or exact names.')
  const result = await client.workflowStates({
    first: 50,
    filter: {
      team: { id: { eq: team.id } },
      or: wanted.flatMap((value) => [
        ...idBranch(value),
        { name: { eqIgnoreCase: value } },
        { type: { eq: value } },
      ]),
    },
  })
  const resolved = wanted.flatMap((value) => {
    const lower = folded(value)
    const idOrName = result.nodes.filter((state) => state.id === value || folded(state.name) === lower)
    if (idOrName.length > 0) return [choose('state', value, result.nodes, idOrName)]
    const byType = result.nodes.filter((state) => folded(state.type) === lower)
    if (byType.length > 0) return byType
    throw new Error(`Linear state not found: ${value}`)
  })
  return [...new Map(resolved.map((state) => [state.id, state])).values()]
}

export async function resolveState(client, selector, team) {
  const states = await resolveStates(client, [selector], team)
  if (states.length !== 1) throw new Error(`Linear state is ambiguous: ${selector}`)
  return states[0]
}

export async function resolveProjectStatuses(client, selector) {
  const wanted = text(selector)
  if (wanted === undefined) throw new Error('Linear project status must be a non-empty ID, type, or exact name.')
  const result = await client.projectStatuses({ first: 50, includeArchived: true })
  const lower = folded(wanted)
  const idOrName = result.nodes.filter((status) => status.id === wanted || folded(status.name) === lower)
  if (idOrName.length > 0) return [choose('project status', wanted, result.nodes, idOrName)]
  const byType = result.nodes.filter((status) => folded(status.type) === lower)
  if (byType.length > 0) return byType
  throw new Error(`Linear project status not found: ${wanted}`)
}

export async function resolveProjectStatus(client, selector) {
  const statuses = await resolveProjectStatuses(client, selector)
  if (statuses.length !== 1) throw new Error(`Linear project status is ambiguous: ${selector}`)
  return statuses[0]
}

function decodeUrlSegment(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new Error('Linear project URL contains an invalid encoded path segment.')
  }
}

function projectPath(urlValue) {
  if (typeof urlValue !== 'string') return undefined
  let url
  try {
    url = new URL(urlValue)
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:' || folded(url.hostname) !== 'linear.app') return undefined
  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length < 3 || folded(segments[1]) !== 'project') return undefined
  return {
    workspace: decodeUrlSegment(segments[0]),
    slug: decodeUrlSegment(segments[2]),
  }
}

function normalizeProjectSelector(selector, organizationUrlKey) {
  const original = text(selector)
  if (original === undefined) throw new Error('Linear project must be a non-empty UUID, API slug ID, exact name, or full project URL.')
  if (!/^[a-z][a-z0-9+.-]*:/iu.test(original)) return { original, wanted: original, fromUrl: false }

  let url
  try {
    url = new URL(original)
  } catch {
    throw new Error('Linear project URL is invalid. Paste a full https://linear.app/.../project/... URL.')
  }
  if (url.protocol !== 'https:' || folded(url.hostname) !== 'linear.app') {
    throw new Error('Linear project URL must use https://linear.app/.')
  }
  const path = projectPath(url.href)
  if (path === undefined || path.slug.length === 0) {
    throw new Error('Linear project URL must contain /{workspace}/project/{project-slug}.')
  }
  const expectedWorkspace = text(organizationUrlKey)
  if (expectedWorkspace !== undefined && folded(path.workspace) !== folded(expectedWorkspace)) {
    throw new Error(`Linear project URL belongs to workspace “${path.workspace}”, not the connected workspace “${expectedWorkspace}”.`)
  }
  return { original, wanted: path.slug, fromUrl: true }
}

function projectMatches(project, wanted) {
  const lower = folded(wanted)
  const path = projectPath(project.url)
  return ['id', 'slugId', 'name'].some((field) => {
    const value = project[field]
    return typeof value === 'string' && (value === wanted || folded(value) === lower)
  }) || (path !== undefined && folded(path.slug) === lower)
}

function projectSlugIdHint(wanted) {
  return wanted.match(/-([a-z0-9]{8,})$/iu)?.[1]
}

function projectNotFound(normalized) {
  return normalized.fromUrl
    ? new Error(`Linear project URL could not be resolved: ${normalized.original}. Use the URL or UUID selector returned by linear_list_projects.`)
    : new Error(`Linear project not found: ${normalized.original}`)
}

function isNotFound(error) {
  return error?.status === 404
    || /not.?found/iu.test(String(error?.type ?? ''))
    || /not found|does not exist|could not find/iu.test(String(error?.message ?? ''))
}

async function directProject(client, normalized) {
  try {
    const project = await client.project(normalized.wanted)
    if (!projectMatches(project, normalized.wanted)) throw projectNotFound(normalized)
    return project
  } catch (error) {
    if (isNotFound(error)) throw projectNotFound(normalized)
    throw error
  }
}

export async function resolveProject(client, selector, options = {}) {
  const normalized = normalizeProjectSelector(selector, options.organizationUrlKey)
  const { wanted } = normalized
  const slugIdHint = projectSlugIdHint(wanted)
  const pathLike = normalized.fromUrl || /^[a-z0-9]+(?:-[a-z0-9]+)+$/iu.test(wanted)
  let result
  try {
    result = await client.projects({
      first: 20,
      includeArchived: true,
      filter: {
        or: [
          ...idBranch(wanted),
          { slugId: { eq: wanted } },
          ...(slugIdHint === undefined ? [] : [{ slugId: { eq: slugIdHint } }]),
          { name: { eqIgnoreCase: wanted } },
        ],
      },
    })
  } catch (error) {
    if (!pathLike) throw error
    try {
      return await directProject(client, normalized)
    } catch {
      throw error
    }
  }

  const matches = result.nodes.filter((project) => projectMatches(project, wanted))
  if (matches.length > 0) return choose('project', normalized.original, result.nodes, matches)
  if (pathLike) return directProject(client, normalized)
  throw projectNotFound(normalized)
}

export async function resolveCycle(client, selector, team) {
  const wanted = text(selector)
  if (wanted === undefined) throw new Error('Linear cycle must be a non-empty ID, number, name, current, next, or previous.')
  const normalized = folded(wanted)
  const special = normalized === 'current' || normalized === 'active'
    ? { isActive: { eq: true } }
    : normalized === 'next'
      ? { isNext: { eq: true } }
      : normalized === 'previous'
        ? { isPrevious: { eq: true } }
        : undefined
  const numeric = /^\d+$/u.test(wanted) ? Number(wanted) : undefined
  const filter = {
    ...(team === undefined ? {} : { team: { id: { eq: team.id } } }),
    ...(special === undefined ? {
      or: [
        ...idBranch(wanted),
        { name: { eqIgnoreCase: wanted } },
        ...(numeric === undefined ? [] : [{ number: { eq: numeric } }]),
      ],
    } : special),
  }
  const result = await client.cycles({ first: 20, includeArchived: true, filter })
  if (special !== undefined) return choose('cycle', wanted, result.nodes, result.nodes)
  return exact('cycle', wanted, result.nodes, ['id', 'name', 'number'])
}

export async function resolveLabels(client, selectors) {
  if (!Array.isArray(selectors) || selectors.length === 0) return []
  const wanted = selectors.map(text)
  if (wanted.some((value) => value === undefined)) throw new Error('Linear labels must be non-empty IDs or exact names.')
  const result = await client.issueLabels({
    first: Math.min(50, wanted.length * 5),
    filter: {
      or: wanted.flatMap((value) => [
        ...idBranch(value),
        { name: { eqIgnoreCase: value } },
      ]),
    },
  })
  return wanted.map((value) => exact('label', value, result.nodes, ['id', 'name']))
}

function idsOf(items, field) {
  return [...new Set(items.map((item) => item[field]).filter((value) => typeof value === 'string'))]
}

function labelIdsOf(items) {
  return [...new Set(items.flatMap((item) => Array.isArray(item.labelIds) ? item.labelIds : []))]
}

function mapById(connection) {
  return new Map((connection?.nodes ?? []).map((item) => [item.id, item]))
}

async function catalog(client, method, ids) {
  if (ids.length === 0) return new Map()
  const chunks = []
  for (let index = 0; index < ids.length; index += 50) chunks.push(ids.slice(index, index + 50))
  const results = await Promise.all(chunks.map((chunk) => client[method]({
    first: chunk.length,
    includeArchived: true,
    ...(method === 'users' ? { includeDisabled: true } : {}),
    filter: { id: { in: chunk } },
  })))
  return new Map(results.flatMap((result) => result.nodes).map((item) => [item.id, item]))
}

export async function issueCatalogs(client, issues) {
  const [teams, states, users, projects, cycles, labels] = await Promise.all([
    catalog(client, 'teams', idsOf(issues, 'teamId')),
    catalog(client, 'workflowStates', idsOf(issues, 'stateId')),
    catalog(client, 'users', idsOf(issues, 'assigneeId')),
    catalog(client, 'projects', idsOf(issues, 'projectId')),
    catalog(client, 'cycles', idsOf(issues, 'cycleId')),
    catalog(client, 'issueLabels', labelIdsOf(issues)),
  ])
  return { teams, states, users, projects, cycles, labels }
}

export async function userCatalog(client, ids) {
  return { users: await catalog(client, 'users', [...new Set(ids.filter(Boolean))]) }
}

export async function projectCatalogs(client, projects) {
  if (projects.length === 0) return { users: new Map(), statuses: new Map() }
  const [users, statusConnection] = await Promise.all([
    catalog(client, 'users', idsOf(projects, 'leadId')),
    client.projectStatuses({ first: 50, includeArchived: true }),
  ])
  const statuses = mapById(statusConnection)
  return { users, statuses }
}
