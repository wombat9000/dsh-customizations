import { publicProject, publicUser, text } from './projections.js'
import { resolveProject, resolveProjectStatus, resolveTeam, resolveUser } from './resolvers.js'

const CLEARABLE_FIELDS = new Set(['description', 'content', 'lead', 'startDate', 'targetDate'])

function iso(value) {
  return new Date(value).toISOString()
}

function timestamp(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} must be an ISO timestamp`)
  const parsed = new Date(value)
  if (Number.isNaN(parsed.valueOf())) throw new Error(`${name} must be an ISO timestamp`)
  return parsed.toISOString()
}

function date(value, name) {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error(`${name} must use YYYY-MM-DD format`)
  }
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${name} must be a valid calendar date`)
  }
  return value
}

function bounded(value, name, maximum, required = false) {
  if (value === undefined && !required) return undefined
  const normalized = text(value)
  if (normalized === undefined) throw new Error(`${name} must be a non-empty string`)
  if (normalized.length > maximum) throw new Error(`${name} must be at most ${maximum} characters`)
  return normalized
}

function priority(value) {
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || value < 0 || value > 4) throw new Error('priority must be an integer from 0 to 4')
  return value
}

function unique(values) {
  return [...new Set(values)]
}

function assertWritableSelectors(status, lead) {
  if (status?.archivedAt != null) throw new Error(`Linear project status is archived: ${status.name}`)
  if (lead?.active === false) throw new Error(`Linear project lead is disabled: ${lead.name}`)
}

function freeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) freeze(child)
  return Object.freeze(value)
}

function sameArray(left, right) {
  return left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index])
}

async function optional(promise) {
  if (promise === undefined) return undefined
  try {
    return await promise
  } catch {
    return undefined
  }
}

async function allProjectTeams(project) {
  const connection = await project.teams({ first: 50 })
  while (connection.pageInfo?.hasNextPage === true && connection.nodes.length < 250) {
    if (typeof connection.fetchNext !== 'function') throw new Error('Linear project team pagination is unavailable')
    await connection.fetchNext()
  }
  if (connection.pageInfo?.hasNextPage === true) {
    throw new Error('Linear project has more than 250 team associations; refusing an incomplete write preview')
  }
  return connection.nodes
}

async function publicDetailedProject(project, maximum) {
  const [lead, status, teams] = await Promise.all([
    optional(project.lead),
    optional(project.status),
    allProjectTeams(project),
  ])
  return publicProject(project, {
    maxDescriptionChars: maximum,
    includeContent: true,
    lead,
    status,
    teams,
  })
}

async function exactDuplicates(client, name) {
  const result = await client.projects({
    first: 20,
    includeArchived: true,
    filter: { name: { eqIgnoreCase: name } },
  })
  return result.nodes.map((project) => ({
    id: project.id,
    name: project.name,
    url: project.url,
    archived: project.archivedAt != null,
  }))
}

function projectResultId(payload, operation) {
  if (payload?.success === true && typeof payload.projectId === 'string') return payload.projectId
  throw new Error(`Linear ${operation} did not return a project`)
}

function projectUpdateResultId(payload) {
  if (payload?.success === true && typeof payload.projectUpdateId === 'string') return payload.projectUpdateId
  throw new Error('Linear project update creation did not return a status report')
}

export function publicProjectUpdate(update, author) {
  return {
    id: update.id,
    projectId: update.projectId,
    body: update.body,
    health: update.health,
    url: update.url,
    ...((author === undefined) ? {} : { author: publicUser(author) }),
    ...(update.userId === undefined ? {} : { userId: update.userId }),
    createdAt: iso(update.createdAt),
    updatedAt: iso(update.updatedAt),
  }
}

export class LinearProjectWrites {
  constructor(runtime) {
    this.runtime = runtime
    this.maxContentChars = runtime.maxDescriptionChars
  }

  async prepareCreate(args, signal) {
    const name = bounded(args.name, 'name', 255, true)
    if (!Array.isArray(args.teams) || args.teams.length === 0) throw new Error('teams must contain at least one Linear team')
    const description = bounded(args.description, 'description', 2_000)
    const content = bounded(args.content, 'content', this.maxContentChars)
    const projectPriority = priority(args.priority)
    const startDate = date(args.startDate, 'startDate')
    const targetDate = date(args.targetDate, 'targetDate')
    if (startDate !== undefined && targetDate !== undefined && startDate > targetDate) {
      throw new Error('startDate must not be after targetDate')
    }
    const { client, organization } = await this.runtime.client(signal)
    const [teams, status, lead, duplicates] = await Promise.all([
      Promise.all(unique(args.teams).map((selector) => this.runtime.request('resolve team', () => resolveTeam(client, selector)))),
      text(args.status) === undefined ? undefined : this.runtime.request('resolve project status', () => resolveProjectStatus(client, args.status)),
      text(args.lead) === undefined ? undefined : this.runtime.request('resolve project lead', () => resolveUser(client, args.lead)),
      this.runtime.request('check duplicate projects', () => exactDuplicates(client, name)),
    ])
    assertWritableSelectors(status, lead)
    const input = {
      name,
      teamIds: teams.map((team) => team.id),
      ...(description === undefined ? {} : { description }),
      ...(content === undefined ? {} : { content }),
      ...(status === undefined ? {} : { statusId: status.id }),
      ...(lead === undefined ? {} : { leadId: lead.id }),
      ...(projectPriority === undefined ? {} : { priority: projectPriority }),
      ...(startDate === undefined ? {} : { startDate }),
      ...(targetDate === undefined ? {} : { targetDate }),
    }
    const warning = duplicates.length === 0
      ? []
      : ['', 'Possible duplicate projects:', ...duplicates.map((project) => `- ${project.name} — ${project.url}${project.archived ? ' (archived)' : ''}`)]
    const reason = [
      `Create Linear project “${name}” in ${organization.name}.`,
      `Teams: ${teams.map((team) => `${team.key} — ${team.name}`).join(', ')}`,
      ...(status === undefined ? [] : [`Status: ${status.name}`]),
      ...(lead === undefined ? [] : [`Lead: ${lead.name}`]),
      ...(input.priority === undefined ? [] : [`Priority: ${input.priority}`]),
      ...warning,
    ].join('\n')
    return freeze({
      kind: 'create-project',
      workspaceId: organization.id,
      input,
      approvedDuplicateIds: duplicates.map((project) => project.id).sort(),
      reason,
    })
  }

  async executeCreate(prepared, signal) {
    const { client, organization } = await this.runtime.client(signal)
    if (organization.id !== prepared.workspaceId) throw new Error('Linear workspace changed after approval; request approval again.')
    const duplicates = await this.runtime.request('recheck duplicate projects', () => exactDuplicates(client, prepared.input.name))
    const newDuplicate = duplicates.find((project) => !prepared.approvedDuplicateIds.includes(project.id))
    if (newDuplicate !== undefined) {
      throw new Error(`A matching Linear project appeared after approval: ${newDuplicate.name}. Review and approve again.`)
    }
    const payload = await this.runtime.request('create project', () => client.createProject(prepared.input))
    const project = await this.runtime.request('load created project', () => client.project(projectResultId(payload, 'project creation')))
    return publicDetailedProject(project, this.maxContentChars)
  }

  async prepareUpdate(args, signal) {
    const { client, organization } = await this.runtime.client(signal)
    const project = await this.runtime.request('resolve project', () => resolveProject(client, args.project, { organizationUrlKey: organization.urlKey }))
    const before = await this.runtime.request('load project snapshot', () => publicDetailedProject(project, this.maxContentChars))
    const expectedUpdatedAt = args.expectedUpdatedAt === undefined
      ? before.updatedAt
      : timestamp(args.expectedUpdatedAt, 'expectedUpdatedAt')
    if (expectedUpdatedAt !== before.updatedAt) {
      throw new Error(`Linear project changed since ${expectedUpdatedAt}; fetch it again before requesting an update.`)
    }
    const clearFields = unique(args.clearFields ?? [])
    if (clearFields.some((field) => !CLEARABLE_FIELDS.has(field))) throw new Error('clearFields contains an unsupported project field')
    for (const field of clearFields) {
      if (args[field] !== undefined) throw new Error(`${field} cannot be set and cleared in the same update`)
    }
    const [status, lead, teams] = await Promise.all([
      text(args.status) === undefined ? undefined : this.runtime.request('resolve project status', () => resolveProjectStatus(client, args.status)),
      text(args.lead) === undefined ? undefined : this.runtime.request('resolve project lead', () => resolveUser(client, args.lead)),
      args.teams === undefined
        ? undefined
        : Promise.all(unique(args.teams).map((selector) => this.runtime.request('resolve team', () => resolveTeam(client, selector)))),
    ])
    assertWritableSelectors(status, lead)
    if (teams !== undefined && teams.length === 0) throw new Error('teams must contain at least one Linear team')
    const desired = {
      ...(args.name === undefined ? {} : { name: bounded(args.name, 'name', 255, true) }),
      ...(args.description === undefined ? {} : { description: bounded(args.description, 'description', 2_000, true) }),
      ...(args.content === undefined ? {} : { content: bounded(args.content, 'content', this.maxContentChars, true) }),
      ...(status === undefined ? {} : { statusId: status.id }),
      ...(lead === undefined ? {} : { leadId: lead.id }),
      ...(args.priority === undefined ? {} : { priority: priority(args.priority) }),
      ...(args.startDate === undefined ? {} : { startDate: date(args.startDate, 'startDate') }),
      ...(args.targetDate === undefined ? {} : { targetDate: date(args.targetDate, 'targetDate') }),
      ...(teams === undefined ? {} : { teamIds: teams.map((team) => team.id) }),
    }
    const beforeValues = {
      name: before.name,
      description: before.description,
      content: before.content,
      statusId: before.statusId,
      leadId: before.leadId,
      priority: before.priority,
      startDate: before.startDate,
      targetDate: before.targetDate,
      teamIds: before.teams.map((team) => team.id),
    }
    for (const field of clearFields) {
      const inputField = field === 'lead' ? 'leadId' : field
      desired[inputField] = null
    }
    const nextStartDate = Object.hasOwn(desired, 'startDate') ? desired.startDate : before.startDate
    const nextTargetDate = Object.hasOwn(desired, 'targetDate') ? desired.targetDate : before.targetDate
    if (nextStartDate != null && nextTargetDate != null && nextStartDate > nextTargetDate) {
      throw new Error('startDate must not be after targetDate')
    }
    const input = {}
    const changes = []
    for (const [field, value] of Object.entries(desired)) {
      const prior = beforeValues[field]
      const equal = Array.isArray(value) && Array.isArray(prior) ? sameArray(value, prior) : value === prior
      if (equal) continue
      input[field] = value
      const label = field === 'statusId' ? 'Status'
        : field === 'leadId' ? 'Lead'
          : field === 'teamIds' ? 'Teams'
            : field[0].toUpperCase() + field.slice(1)
      const from = field === 'statusId' ? before.status?.name
        : field === 'leadId' ? before.lead?.name
          : field === 'teamIds' ? before.teams.map((team) => team.key).join(', ')
            : field === 'content' ? `${String(prior ?? '').length} characters`
              : prior
      const to = field === 'statusId' ? status?.name ?? 'cleared'
        : field === 'leadId' ? lead?.name ?? 'cleared'
          : field === 'teamIds' ? teams.map((team) => team.key).join(', ')
            : field === 'content' ? `${String(value ?? '').length} characters`
              : value
      changes.push(`${label}: ${from ?? 'unset'} → ${to ?? 'cleared'}`)
    }
    if (changes.length === 0) throw new Error('Linear project update does not change any supported field.')
    const duplicates = input.name === undefined
      ? []
      : (await this.runtime.request('check duplicate projects', () => exactDuplicates(client, input.name)))
          .filter((candidate) => candidate.id !== project.id)
    const removedTeams = teams === undefined
      ? []
      : before.teams.filter((candidate) => !teams.some((selected) => selected.id === candidate.id))
    const warnings = [
      ...(status?.type === 'completed' || status?.type === 'canceled'
        ? [`Warning: this moves the project to ${status.type}.`]
        : []),
      ...(removedTeams.length === 0
        ? []
        : [`Warning: this removes team associations: ${removedTeams.map((candidate) => candidate.key).join(', ')}.`]),
      ...(duplicates.length === 0
        ? []
        : ['Possible duplicate projects after rename:', ...duplicates.map((candidate) => `- ${candidate.name} — ${candidate.url}${candidate.archived ? ' (archived)' : ''}`)]),
    ]
    return freeze({
      kind: 'update-project',
      workspaceId: organization.id,
      projectId: project.id,
      expectedUpdatedAt,
      input,
      approvedDuplicateIds: duplicates.map((candidate) => candidate.id).sort(),
      reason: [
        `Update Linear project “${before.name}” in ${organization.name}.`,
        ...changes,
        ...(warnings.length === 0 ? [] : ['', ...warnings]),
      ].join('\n'),
    })
  }

  async executeUpdate(prepared, signal) {
    const { client, organization } = await this.runtime.client(signal)
    if (organization.id !== prepared.workspaceId) throw new Error('Linear workspace changed after approval; request approval again.')
    const project = await this.runtime.request('reload project', () => client.project(prepared.projectId))
    if (iso(project.updatedAt) !== prepared.expectedUpdatedAt) {
      throw new Error('Linear project changed while approval was pending; fetch the latest project and approve a new update.')
    }
    if (prepared.input.name !== undefined) {
      const duplicates = (await this.runtime.request('recheck duplicate projects', () => exactDuplicates(client, prepared.input.name)))
        .filter((candidate) => candidate.id !== prepared.projectId)
      const newDuplicate = duplicates.find((candidate) => !prepared.approvedDuplicateIds.includes(candidate.id))
      if (newDuplicate !== undefined) {
        throw new Error(`A matching Linear project appeared after approval: ${newDuplicate.name}. Review and approve again.`)
      }
    }
    const payload = await this.runtime.request('update project', () => project.update(prepared.input))
    const updated = await this.runtime.request('load updated project', () => client.project(projectResultId(payload, 'project update')))
    return publicDetailedProject(updated, this.maxContentChars)
  }

  async prepareProjectUpdate(args, signal) {
    const { client, organization } = await this.runtime.client(signal)
    const project = await this.runtime.request('resolve project', () => resolveProject(client, args.project, { organizationUrlKey: organization.urlKey }))
    const body = bounded(args.body, 'body', this.maxContentChars, true)
    if (!['onTrack', 'atRisk', 'offTrack'].includes(args.health)) {
      throw new Error('health must be onTrack, atRisk, or offTrack')
    }
    return freeze({
      kind: 'create-project-update',
      workspaceId: organization.id,
      projectId: project.id,
      expectedUpdatedAt: iso(project.updatedAt),
      input: { projectId: project.id, body, health: args.health },
      reason: `Post a Linear status report to “${project.name}” in ${organization.name}.\nHealth: ${args.health}\nBody: ${body.length} characters`,
    })
  }

  async executeProjectUpdate(prepared, signal) {
    const { client, organization } = await this.runtime.client(signal)
    if (organization.id !== prepared.workspaceId) throw new Error('Linear workspace changed after approval; request approval again.')
    const project = await this.runtime.request('reload project', () => client.project(prepared.projectId))
    if (iso(project.updatedAt) !== prepared.expectedUpdatedAt) {
      throw new Error('Linear project changed while approval was pending; review it and approve the status report again.')
    }
    const payload = await this.runtime.request('create project update', () => client.createProjectUpdate(prepared.input))
    const update = await this.runtime.request('load created project update', () => client.projectUpdate(projectUpdateResultId(payload)))
    const author = await optional(update.user)
    return publicProjectUpdate(update, author)
  }
}
