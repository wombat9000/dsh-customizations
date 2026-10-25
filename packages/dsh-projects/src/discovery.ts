import type {
  DiscoverPage,
  SourceCandidate,
  SourceKind,
  SourceTarget,
} from '../shared/contracts.js'
import { slug } from '../shared/slug.js'
import { fail, source } from './configuration.js'

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
const string = (value: unknown, max = 500) =>
  typeof value === 'string' ? (value.length > max ? `${value.slice(0, max - 1)}…` : value) : ''

function candidate(
  target: SourceTarget,
  name: string,
  extra: { description?: string; inactive?: boolean },
): SourceCandidate | undefined {
  try {
    // Reuse configuration validation so every candidate can be saved as-is.
    const { id: _, ...valid } = source({ id: 'candidate', ...target })
    return {
      target: valid as SourceTarget,
      name: name || 'Unnamed',
      suggestedId: slug(name, target.kind),
      ...(extra.description ? { description: extra.description } : {}),
      ...(extra.inactive ? { inactive: true } : {}),
    }
  } catch {
    return undefined
  }
}

// Maps one provider discovery page to configurable source candidates. Entries that
// fail source validation are dropped rather than repaired.
export function discoverPage(
  kind: SourceKind,
  owner: string | undefined,
  result: unknown,
): DiscoverPage {
  const envelope = object(result)
  const github = kind.startsWith('github-')
  const data = github ? object(envelope.data) : envelope
  const nodes = github ? data.nodes : kind === 'linear-team' ? data.teams : data.projects
  if (!Array.isArray(nodes) || nodes.length > 100) fail('response')
  const pageInfo = object(data.pageInfo)
  const hasNextPage = pageInfo.hasNextPage === true
  const cursor = github ? (data.nextCursor ?? pageInfo.endCursor) : pageInfo.nextCursor
  if (hasNextPage && (typeof cursor !== 'string' || !cursor || cursor.length > 4096))
    fail('response')
  const candidates = nodes.flatMap((value) => {
    const node = object(value)
    let result: SourceCandidate | undefined
    switch (kind) {
      case 'github-repository': {
        const repo = string(node.name, 100)
        const nodeOwner = string(object(node.owner).login, 100) || owner || ''
        result = candidate({ kind, owner: nodeOwner, repo }, repo, {
          description: string(node.description),
          inactive: node.isArchived === true,
        })
        break
      }
      case 'github-project': {
        const title = string(node.title, 200)
        const nodeOwner = string(object(node.owner).login, 100) || owner || ''
        result = candidate({ kind, owner: nodeOwner, projectNumber: Number(node.number) }, title, {
          description: string(node.shortDescription),
          inactive: node.closed === true || node.template === true,
        })
        break
      }
      case 'linear-project': {
        const name = string(node.name, 200)
        const state = string(node.state, 40)
        result = candidate({ kind, project: string(node.id, 36) }, name, {
          description: string(node.description),
          inactive: ['completed', 'canceled'].includes(state),
        })
        break
      }
      case 'linear-team': {
        const name = string(node.name, 200)
        const key = string(node.key, 20)
        result = candidate({ kind, team: string(node.id, 36) }, name, {
          ...(key ? { description: key } : {}),
        })
      }
    }
    return result ? [result] : []
  })
  return {
    kind,
    ...(owner ? { owner } : {}),
    candidates,
    hasNextPage,
    ...(hasNextPage && typeof cursor === 'string' ? { nextCursor: cursor } : {}),
    untrusted: true,
  }
}
