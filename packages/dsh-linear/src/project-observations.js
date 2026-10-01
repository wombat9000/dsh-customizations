import { publicProject } from './projections.js'
import { resolveProject } from './resolvers.js'

async function optional(promise) {
  if (promise === undefined) return undefined
  try {
    return await promise
  } catch {
    return undefined
  }
}

// SDK connections accumulate nodes in fetchNext(). Approval checks must not use
// a partial catalog, or loop indefinitely when the provider makes no progress.
async function completeNodes(connection, kind, maximum = 250) {
  let pages = 1
  while (
    connection.pageInfo?.hasNextPage === true &&
    connection.nodes.length < maximum &&
    pages < maximum
  ) {
    if (typeof connection.fetchNext !== 'function')
      throw new Error(`Linear ${kind} pagination is unavailable`)
    const previousCount = connection.nodes.length
    const previousCursor = connection.pageInfo.endCursor
    await connection.fetchNext()
    pages += 1
    if (
      connection.pageInfo?.hasNextPage === true &&
      connection.nodes.length <= previousCount &&
      connection.pageInfo.endCursor === previousCursor
    ) {
      throw new Error(
        `Linear ${kind} pagination made no progress; refusing an incomplete write preview`,
      )
    }
  }
  if (connection.pageInfo?.hasNextPage !== false || connection.nodes.length > maximum) {
    throw new Error(
      `Linear ${kind} exceeds ${maximum} entries or has unknown completeness; refusing an incomplete write preview`,
    )
  }
  return connection.nodes
}

// Owns provider observations used by both detailed reads and write safeguards.
export class LinearProjectObservations {
  constructor(runtime) {
    this.runtime = runtime
  }

  resolve(client, organization, selector) {
    return this.runtime.request('resolve project', () =>
      resolveProject(client, selector, { organizationUrlKey: organization.urlKey }),
    )
  }

  async snapshot(project, { completeTeams = false } = {}) {
    const [lead, status, teams] = await Promise.all([
      optional(project.lead),
      optional(project.status),
      project
        .teams({ first: 50 })
        .then((connection) =>
          completeTeams ? completeNodes(connection, 'project team associations') : connection.nodes,
        ),
    ])
    return publicProject(project, {
      maxDescriptionChars: this.runtime.maxDescriptionChars,
      includeContent: true,
      lead,
      status,
      teams,
    })
  }

  async duplicates(client, name, { excludeId, operation = 'check duplicate projects' } = {}) {
    return this.runtime.request(operation, async () => {
      const connection = await client.projects({
        first: 20,
        includeArchived: true,
        filter: { name: { eqIgnoreCase: name } },
      })
      const projects = await completeNodes(connection, 'matching projects')
      return projects
        .filter((project) => project.id !== excludeId)
        .map((project) => ({
          id: project.id,
          name: project.name,
          url: project.url,
          archived: project.archivedAt != null,
        }))
    })
  }

  async approved(prepared, signal) {
    const { client, organization } = await this.runtime.client(signal)
    if (organization.id !== prepared.workspaceId)
      throw new Error('Linear workspace changed after approval; request approval again.')
    const project = await this.#recheck(client, prepared)
    signal?.throwIfAborted()
    return { client, project }
  }

  async #recheck(client, prepared) {
    let project
    if (prepared.kind !== 'create-project') {
      project = await this.runtime.request('reload project', () =>
        client.project(prepared.projectId),
      )
      if (new Date(project.updatedAt).toISOString() !== prepared.expectedUpdatedAt) {
        throw new Error(
          prepared.kind === 'create-project-update'
            ? 'Linear project changed while approval was pending; review it and approve the status report again.'
            : 'Linear project changed while approval was pending; fetch the latest project and approve a new update.',
        )
      }
    }
    if (prepared.kind !== 'create-project-update' && prepared.input.name !== undefined) {
      const duplicates = await this.duplicates(client, prepared.input.name, {
        excludeId: prepared.projectId,
        operation: 'recheck duplicate projects',
      })
      const newDuplicate = duplicates.find(
        (candidate) => !prepared.approvedDuplicateIds.includes(candidate.id),
      )
      if (newDuplicate !== undefined) {
        throw new Error(
          `A matching Linear project appeared after approval: ${newDuplicate.name}. Review and approve again.`,
        )
      }
    }
    return project
  }
}
