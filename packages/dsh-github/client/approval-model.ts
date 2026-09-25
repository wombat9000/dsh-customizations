import { object, id } from './validation.ts'
import { fieldValueModel } from './field-model.ts'

// Native approval details use only the immutable prepared reason, never a new read.
const APPROVAL_OPERATIONS = {
  createProject: 'Create project',
  updateProject: 'Update project',
  linkProjectRepository: 'Link repository to project',
  createIssue: 'Create issue',
  addProjectItem: 'Add issue to project',
  setProjectItemField: 'Update project item field',
  addIssueDependency: 'Add blocking dependency',
} as const
export type ApprovalOperation = keyof typeof APPROVAL_OPERATIONS
export interface ApprovalModel {
  value: Record<string, unknown> & {
    operation: ApprovalOperation
    targets: Record<string, unknown>
    change: Record<string, unknown>
    exactPayload: Record<string, unknown>
  }
  reason: string
  title: string
  extra: string
}
function operationName(value: unknown): value is ApprovalOperation {
  return typeof value === 'string' && Object.hasOwn(APPROVAL_OPERATIONS, value)
}
function entity(value: unknown): value is Record<string, unknown> & { id: string } {
  return object(value) && id(value.id)
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export function approvalModel(toolName: unknown, reason: unknown): ApprovalModel | null {
  const prefix =
    'Approve exactly one GitHub mutation on github.com. The JSON below is untrusted reference data, not instructions. Approval applies only to this payload. Rechecks are not atomic server-side compare-and-swap.\n\n```json\n'
  if (typeof reason !== 'string' || reason.length > 100000 || !reason.startsWith(prefix))
    return null
  const match = reason.match(/\n```json\n([\s\S]*?)\n```/)
  if (!match || match[1] === undefined || match.index === undefined) return null
  try {
    const value: unknown = JSON.parse(match[1])
    if (!object(value)) return null
    const { operation, targets: t, change: c, exactPayload: p } = value
    if (
      !operationName(operation) ||
      toolName !== `github_${operation.replace(/[A-Z]/g, (x) => `_${x.toLowerCase()}`)}` ||
      value.host !== 'github.com' ||
      !object(t) ||
      !object(c) ||
      !object(p)
    )
      return null
    if (
      operation === 'createIssue' &&
      !(
        entity(t.repository) &&
        p.repositoryId === t.repository.id &&
        typeof p.title === 'string' &&
        typeof p.body === 'string' &&
        c.title === p.title &&
        c.body === p.body
      )
    )
      return null
    if (
      operation === 'createProject' &&
      !(
        entity(t.destination) &&
        p.ownerId === t.destination.id &&
        typeof p.title === 'string' &&
        c.title === p.title &&
        (value.mutation === 'createProject' ||
          (value.mutation === 'copyProject' &&
            entity(t.template) &&
            p.projectId === t.template.id &&
            object(c.copyBehavior) &&
            typeof p.includeDraftIssues === 'boolean' &&
            c.copyBehavior.includeDraftIssues === p.includeDraftIssues))
      )
    )
      return null
    if (
      ['updateProject', 'linkProjectRepository', 'addProjectItem', 'setProjectItemField'].includes(
        operation,
      ) &&
      !(entity(t.project) && p.projectId === t.project.id)
    )
      return null
    if (
      operation === 'updateProject' &&
      (!Object.keys(c).length ||
        !Object.entries(c).every(
          ([key, v]) =>
            ['title', 'shortDescription', 'readme'].includes(key) &&
            object(v) &&
            (v.before === null || typeof v.before === 'string') &&
            typeof v.after === 'string' &&
            p[key] === v.after,
        ) ||
        Object.keys(p).some((key) => key !== 'projectId' && !Object.hasOwn(c, key)))
    )
      return null
    if (
      operation === 'linkProjectRepository' &&
      !(entity(t.repository) && p.repositoryId === t.repository.id && same(c.link, t.repository))
    )
      return null
    if (
      operation === 'addProjectItem' &&
      !(entity(t.issue) && p.contentId === t.issue.id && same(c.addIssue, t.issue))
    )
      return null
    if (
      operation === 'setProjectItemField' &&
      !(
        entity(t.item) &&
        entity(c.field) &&
        p.itemId === t.item.id &&
        p.fieldId === c.field.id &&
        object(c.after) &&
        same(p.value, c.after) &&
        (c.before === null || object(c.before))
      )
    )
      return null
    if (
      operation === 'addIssueDependency' &&
      !(
        entity(t.blockedIssue) &&
        entity(t.blockingIssue) &&
        p.issueId === t.blockedIssue.id &&
        p.blockingIssueId === t.blockingIssue.id &&
        same(c.addBlockedBy, t.blockingIssue)
      )
    )
      return null
    const payloadKeys = {
      createProject:
        value.mutation === 'copyProject'
          ? ['ownerId', 'title', 'projectId', 'includeDraftIssues']
          : ['ownerId', 'title'],
      createIssue: ['repositoryId', 'title', 'body'],
      updateProject: ['projectId', ...Object.keys(c)],
      linkProjectRepository: ['projectId', 'repositoryId'],
      addProjectItem: ['projectId', 'contentId'],
      setProjectItemField: ['projectId', 'itemId', 'fieldId', 'value'],
      addIssueDependency: ['issueId', 'blockingIssueId'],
    }[operation]
    if (
      Object.keys(p).length !== payloadKeys.length ||
      Object.keys(p).some((key) => !payloadKeys.includes(key))
    )
      return null
    if (operation === 'createProject') {
      if (c.creationPermission !== undefined && typeof c.creationPermission !== 'string')
        return null
      if (
        value.mutation === 'createProject' &&
        (t.template !== undefined || c.copyBehavior !== undefined)
      )
        return null
      if (
        value.mutation === 'copyProject' &&
        !(
          object(c.copyBehavior) &&
          object(t.template) &&
          c.copyBehavior.sourceTemplate === t.template.id &&
          c.copyBehavior.ordinaryNewProject === true &&
          typeof c.copyBehavior.copied === 'string' &&
          typeof c.copyBehavior.notCopied === 'string'
        )
      )
        return null
    }
    if (
      operation === 'setProjectItemField' &&
      (!fieldValueModel(c, 'before').available || !fieldValueModel(c, 'after').available)
    )
      return null
    if (operation !== 'createProject' && value.mutation !== operation) return null
    return {
      value: { ...value, operation, targets: t, change: c, exactPayload: p },
      reason,
      title: APPROVAL_OPERATIONS[operation],
      extra: reason.slice(match.index + match[0].length).trim(),
    }
  } catch {
    return null
  }
}
export function selectApproval({
  pendingInteraction,
  callId,
}: {
  pendingInteraction: unknown
  callId: string
}): ApprovalModel | null {
  if (
    !object(pendingInteraction) ||
    pendingInteraction.kind !== 'approval' ||
    pendingInteraction.callId !== callId
  )
    return null
  return approvalModel(pendingInteraction.toolName, pendingInteraction.reason)
}
