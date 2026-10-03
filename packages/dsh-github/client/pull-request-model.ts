import type { ToolBlock } from '../shared/contracts.ts'
import { object, text } from './validation.ts'
import {
  inspectCollections,
  supplied,
  type Completeness,
  type BoundedInspection,
} from './collection-completeness.ts'

export const PR_TOOL_TITLES = {
  github_list_pull_requests: 'Pull requests',
  github_get_pull_request: 'Pull request details',
  github_get_pull_request_files: 'Changed files',
  github_get_pull_request_reviews: 'Reviews',
  github_get_pull_request_threads: 'Review threads',
  github_get_pull_request_checks: 'Checks',
  github_get_pull_request_stack: 'Stack details',
  github_create_pull_request: 'Create draft pull request',
  github_update_pull_request: 'Update pull request',
  github_submit_pull_request_review: 'Submit review',
  github_create_pull_request_stack: 'Create stack',
  github_add_pull_request_to_stack: 'Append to stack',
} as const
export const PR_TOOLS = Object.keys(PR_TOOL_TITLES)
export type PRToolName = keyof typeof PR_TOOL_TITLES
export interface PRCardModel {
  title: string
  status: string
  warnings: string[]
  completeness: Completeness
  inspection?: BoundedInspection
  entries: Record<string, unknown>[]
  target: string
  error?: string
  change?: Record<string, unknown>
  pullRequest?: Record<string, unknown>
  total?: number
}
const knownTool = (name: string): name is PRToolName => Object.hasOwn(PR_TOOL_TITLES, name)
const writeTool = (name: string) => /^github_(create|update|submit|add)_/.test(name)
export function pullRequestCardModel(toolName: string, block?: ToolBlock): PRCardModel {
  const base: PRCardModel = {
    title: knownTool(toolName) ? PR_TOOL_TITLES[toolName] : 'Pull request interaction',
    status: 'Result unavailable',
    warnings: [],
    completeness: 'unknown',
    entries: [],
    target: '',
  }
  if (!knownTool(toolName)) return base
  try {
    const raw = block?.call?.argsRaw ?? block?.argsRaw
    if (raw && raw.length <= 65536) {
      const args: unknown = JSON.parse(raw)
      if (object(args) && typeof args.owner === 'string' && typeof args.repo === 'string')
        base.target = `${args.owner}/${args.repo}${Number.isSafeInteger(args.pullNumber) ? ` #${args.pullNumber}` : ''}`
    }
  } catch {
    /* Supplied arguments are not execution or approval evidence. */
  }
  if (block?.kind !== 'tool-result')
    return {
      ...base,
      status:
        toolName === 'github_create_pull_request'
          ? 'Pending or running · draft creation'
          : toolName === 'github_update_pull_request'
            ? 'Pending or running · PR update'
            : writeTool(toolName)
              ? 'Pending or running · approval required'
              : 'Reading…',
    }
  try {
    const parts = block.content?.filter((part) => part.type === 'text')
    if (parts?.length !== 1 || typeof parts[0]?.text !== 'string' || parts[0].text.length > 524288)
      throw new Error()
    const envelope: unknown = JSON.parse(parts[0].text)
    if (!object(envelope) || envelope.host !== 'github.com') throw new Error()
    if (object(envelope.error))
      return {
        ...base,
        status: 'Failed',
        error: text(envelope.error.message) || 'Inspect raw tool details.',
      }
    if (envelope.untrusted !== true) throw new Error()
    if (envelope.outcome === 'uncertain')
      return {
        ...base,
        status: 'Outcome uncertain',
        warnings: [
          ['github_create_pull_request', 'github_update_pull_request'].includes(toolName)
            ? 'The request may have succeeded. Inspect GitHub before making a new call; do not retry automatically.'
            : 'The request may have succeeded. Inspect GitHub before requesting fresh approval; do not retry automatically.',
          ...(envelope.backendFenced === true
            ? ['GitHub backend fenced after unconfirmed process cleanup.']
            : []),
        ],
      }
    if (block.isError === true)
      return {
        ...base,
        status: 'Failed',
        error: 'The tool reported an error. Inspect raw tool details; success is not inferred.',
      }
    if (writeTool(toolName)) {
      if (envelope.outcome !== 'confirmed' || !object(envelope.resource)) throw new Error()
      const resource = envelope.resource
      if (typeof resource.id !== 'string' || !resource.id) throw new Error()
      if (toolName.includes('stack')) {
        if (
          !Number.isSafeInteger(resource.number) ||
          !object(resource.pullRequests) ||
          !Array.isArray(resource.pullRequests.nodes) ||
          resource.pullRequests.nodes.length < 2 ||
          !resource.pullRequests.nodes.every(
            (member: unknown) => object(member) && Number.isSafeInteger(member.number),
          )
        )
          throw new Error()
      } else if (toolName === 'github_submit_pull_request_review') {
        if (
          !['COMMENTED', 'APPROVED', 'CHANGES_REQUESTED'].includes(text(resource.state)) ||
          !/^[a-f0-9]{40}$/.test(text(resource.commitSha))
        )
          throw new Error()
      } else if (
        !Number.isSafeInteger(resource.number) ||
        typeof resource.title !== 'string' ||
        typeof resource.isDraft !== 'boolean'
      )
        throw new Error()
      return {
        ...base,
        status: 'Confirmed',
        entries: [envelope.resource],
        ...(object(envelope.change) ? { change: envelope.change } : {}),
        warnings: [],
      }
    }
    if (!object(envelope.data)) throw new Error()
    const data = envelope.data
    const collectionKeys: Readonly<Record<string, string>> = {
      github_list_pull_requests: 'pullRequests',
      github_get_pull_request_files: 'files',
      github_get_pull_request_reviews: 'reviews',
      github_get_pull_request_threads: 'threads',
      github_get_pull_request_stack: 'stacks',
    }
    const key = collectionKeys[toolName]
    let collection: unknown[]
    let total: unknown
    if (toolName === 'github_get_pull_request') collection = [data.pullRequest]
    else if (toolName === 'github_get_pull_request_checks') {
      const runs = supplied(data.checkRuns, 'nodes'),
        statuses = supplied(data.statuses, 'nodes')
      if (!Array.isArray(runs) || !Array.isArray(statuses)) throw new Error()
      collection = [...runs, ...statuses]
    } else if (toolName === 'github_get_pull_request_threads' && object(data.thread))
      collection = [data.thread]
    else {
      const connection = key ? data[key] : undefined
      const nodes = supplied(connection, 'nodes')
      if (!Array.isArray(nodes)) throw new Error()
      collection = nodes
      total = supplied(connection, 'totalCount')
    }
    if (!collection.every(object)) throw new Error()
    const inspection = inspectCollections(envelope, toolName)
    const warnings = inspection.notices.map((notice) => notice.message)
    if (Array.isArray(data.warnings))
      warnings.push(
        ...data.warnings.filter((warning): warning is string => typeof warning === 'string'),
      )
    if (collection.length > 5)
      warnings.push(
        `Showing 5 of ${collection.length} returned entries. Expand remaining entries or raw tool details.`,
      )
    if (collection.length > 100)
      warnings.push(
        'Only the first 100 combined entries can be displayed. Additional entries are in raw tool details.',
      )
    return {
      ...base,
      status: `${collection.length} ${toolName === 'github_get_pull_request' ? 'PR' : 'entries'} returned`,
      entries: collection.slice(0, 100),
      warnings,
      inspection,
      completeness: inspection.completeness,
      ...(toolName !== 'github_get_pull_request' && object(data.pullRequest)
        ? { pullRequest: data.pullRequest }
        : {}),
      ...(Number.isSafeInteger(total) && Number(total) >= 0 ? { total: Number(total) } : {}),
    }
  } catch {
    return {
      ...base,
      error:
        'Readable result unavailable. Inspect raw tool details; no success or completeness is inferred.',
    }
  }
}

export function pullRequestEntryLabel(entry: Record<string, unknown>): string {
  const number = Number.isSafeInteger(entry.number) ? `#${entry.number} ` : ''
  return (
    number +
    (text(entry.title) ||
      text(entry.path) ||
      text(entry.filename) ||
      text(entry.name) ||
      text(entry.context) ||
      text(entry.state) ||
      text(entry.body).slice(0, 120) ||
      text(supplied(entry.head, 'ref')) ||
      'Details')
  )
}
export function pullRequestEntryContext(entry: Record<string, unknown>): string[] {
  const values: string[] = []
  if (typeof entry.isDraft === 'boolean' || typeof entry.draft === 'boolean')
    values.push((entry.isDraft ?? entry.draft) === true ? 'Draft' : 'Ready for review')
  if (typeof entry.state === 'string') values.push(entry.state)
  if (typeof entry.status === 'string') values.push(entry.status)
  if (Object.hasOwn(entry, 'conclusion'))
    values.push(
      entry.conclusion === null
        ? 'Conclusion pending'
        : text(entry.conclusion) || 'Conclusion unavailable',
    )
  const head = text(entry.headRefName) || text(supplied(entry.head, 'ref'))
  const base = text(entry.baseRefName) || text(supplied(entry.base, 'ref'))
  if (head && base) values.push(`${head} → ${base}`)
  const sha =
    text(entry.headRefOid) ||
    text(supplied(entry.head, 'sha')) ||
    text(entry.commitSha) ||
    text(entry.headSha) ||
    text(entry.commit_id)
  if (sha) values.push(`Commit ${sha.slice(0, 12)}`)
  if (typeof entry.isResolved === 'boolean')
    values.push(entry.isResolved ? 'Resolved' : 'Unresolved')
  if (entry.isOutdated === true) values.push('Outdated')
  if (typeof entry.additions === 'number' && typeof entry.deletions === 'number')
    values.push(`+${entry.additions} / −${entry.deletions}`)
  return values
}
