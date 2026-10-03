import { object, id, safeUrl } from './validation.ts'

const positive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 2147483647
const sha = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value)
const keys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).length === allowed.length &&
  Object.keys(value).every((key) => allowed.includes(key))
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
const branch = (value: unknown): value is Record<string, unknown> =>
  object(value) && typeof value.ref === 'string' && value.ref.length > 0 && sha(value.sha)

function repository(value: unknown): value is Record<string, unknown> & { nameWithOwner: string } {
  return (
    object(value) &&
    id(value.id) &&
    typeof value.nameWithOwner === 'string' &&
    /^[^/\s]+\/[^/\s]+$/.test(value.nameWithOwner) &&
    safeUrl(value.url)?.toLowerCase() === `https://github.com/${value.nameWithOwner}`.toLowerCase()
  )
}
function pullRequest(
  value: unknown,
  repo: Record<string, unknown>,
): value is Record<string, unknown> {
  return (
    object(value) &&
    id(value.id) &&
    positive(value.number) &&
    safeUrl(value.url)?.toLowerCase() ===
      `https://github.com/${repo.nameWithOwner}/pull/${value.number}`.toLowerCase() &&
    object(value.repository) &&
    value.repository.id === repo.id &&
    value.repository.nameWithOwner === repo.nameWithOwner &&
    value.state === 'OPEN' &&
    typeof value.isDraft === 'boolean' &&
    typeof value.title === 'string' &&
    typeof value.body === 'string' &&
    branch(value.head) &&
    branch(value.base)
  )
}
function inlineComment(value: unknown) {
  if (
    !object(value) ||
    typeof value.path !== 'string' ||
    !value.path ||
    value.path.startsWith('/') ||
    value.path.includes('\\') ||
    value.path.split('/').some((part) => !part || part === '..' || part === '.') ||
    typeof value.body !== 'string' ||
    !value.body.trim() ||
    !positive(value.line) ||
    typeof value.side !== 'string' ||
    !['LEFT', 'RIGHT'].includes(value.side)
  )
    return false
  const multiline = Object.hasOwn(value, 'start_line') || Object.hasOwn(value, 'start_side')
  return (
    keys(value, [
      'path',
      'body',
      'line',
      'side',
      ...(multiline ? ['start_line', 'start_side'] : []),
    ]) &&
    (!multiline ||
      (positive(value.start_line) &&
        value.start_line < value.line &&
        value.start_side === value.side))
  )
}

/** Validate the complete immutable PR change before hiding the native raw reason.
 * This is presentation admission, not authorization or a new GitHub read.
 */
export function pullRequestApprovalPayloadKeys(
  operation: string,
  targets: Record<string, unknown>,
  change: Record<string, unknown>,
  payload: Record<string, unknown>,
): string[] | null {
  if (!repository(targets.repository)) return null
  const repo = targets.repository
  if (operation === 'updatePullRequest' || operation === 'submitPullRequestReview') {
    if (!pullRequest(targets.pullRequest, repo)) return null
    const pr = targets.pullRequest
    if (operation === 'updatePullRequest') {
      if (!object(change.before) || !object(change.after) || !keys(change, ['before', 'after']))
        return null
      if (Object.hasOwn(payload, 'pullRequestId')) {
        return payload.pullRequestId === pr.id &&
          keys(payload, ['pullRequestId']) &&
          keys(change.before, ['draft']) &&
          keys(change.after, ['draft']) &&
          change.before.draft === pr.isDraft &&
          typeof change.after.draft === 'boolean' &&
          change.before.draft !== change.after.draft
          ? ['pullRequestId']
          : null
      }
      const before = change.before
      const edited = Object.keys(payload)
      return edited.length > 0 &&
        edited.every((key) => ['title', 'body'].includes(key)) &&
        keys(change.before, edited) &&
        same(change.after, payload) &&
        edited.every((key) => typeof payload[key] === 'string' && before[key] === pr[key]) &&
        (payload.title === undefined ||
          (typeof payload.title === 'string' &&
            payload.title.trim().length > 0 &&
            payload.title.length <= 256 &&
            !/[\r\n\t]/.test(payload.title)))
        ? edited
        : null
    }
    const expected = [
      'commit_id',
      'body',
      'event',
      ...(Object.hasOwn(payload, 'comments') ? ['comments'] : []),
    ]
    return keys(payload, expected) &&
      keys(change, ['before', 'after']) &&
      change.before === null &&
      same(change.after, payload) &&
      object(pr.head) &&
      payload.commit_id === pr.head.sha &&
      typeof payload.body === 'string' &&
      typeof payload.event === 'string' &&
      ['COMMENT', 'APPROVE', 'REQUEST_CHANGES'].includes(payload.event) &&
      (payload.event === 'APPROVE' || payload.body.trim().length > 0) &&
      (payload.comments === undefined ||
        (Array.isArray(payload.comments) &&
          payload.comments.length > 0 &&
          payload.comments.length <= 20 &&
          payload.comments.every(inlineComment)))
      ? expected
      : null
  }
  if (operation !== 'createPullRequestStack' && operation !== 'addPullRequestToStack') return null
  if (
    !keys(payload, ['pull_requests']) ||
    !keys(change, ['before', 'after']) ||
    !Array.isArray(targets.pullRequests) ||
    !Array.isArray(change.after) ||
    change.after.length < 2 ||
    change.after.length > 50 ||
    !change.after.every(positive) ||
    new Set(change.after).size !== change.after.length ||
    targets.pullRequests.length !== change.after.length ||
    !targets.pullRequests.every((pr) => pullRequest(pr, repo))
  )
    return null
  const prs = targets.pullRequests
  const after = change.after
  if (
    new Set(prs.map((pr) => pr.id)).size !== prs.length ||
    !prs.every((pr, index) => pr.number === after[index])
  )
    return null
  for (let index = 1; index < prs.length; index++) {
    const previous = prs[index - 1],
      next = prs[index]
    if (
      !previous ||
      !next ||
      !object(previous.head) ||
      !object(next.base) ||
      previous.head.ref !== next.base.ref ||
      previous.head.sha !== next.base.sha
    )
      return null
  }
  if (operation === 'createPullRequestStack') {
    return change.before === null &&
      targets.stack === undefined &&
      same(payload.pull_requests, change.after)
      ? ['pull_requests']
      : null
  }
  if (
    !Array.isArray(change.before) ||
    change.before.length !== change.after.length - 1 ||
    !same(change.before, change.after.slice(0, -1)) ||
    !same(payload.pull_requests, change.after.slice(-1)) ||
    !object(targets.stack)
  )
    return null
  const stack = targets.stack
  if (
    !id(stack.id) ||
    !positive(stack.number) ||
    stack.open !== true ||
    stack.apiUrl !== `https://api.github.com/repos/${repo.nameWithOwner}/stacks/${stack.number}` ||
    !object(stack.pullRequests) ||
    !Array.isArray(stack.pullRequests.nodes) ||
    stack.pullRequests.totalCount !== change.before.length ||
    stack.pullRequests.nodes.length !== change.before.length ||
    !object(stack.pullRequests.pageInfo) ||
    stack.pullRequests.pageInfo.hasNextPage !== false ||
    stack.pullRequests.pageInfo.nextPage !== null
  )
    return null
  for (const [index, member] of stack.pullRequests.nodes.entries()) {
    const pr = prs[index]
    if (
      !object(member) ||
      !pr ||
      member.id !== pr.id ||
      member.number !== pr.number ||
      !object(member.head) ||
      !object(member.base) ||
      !object(pr.head) ||
      !object(pr.base) ||
      member.head.ref !== pr.head.ref ||
      member.head.sha !== pr.head.sha ||
      member.base.ref !== pr.base.ref ||
      member.base.sha !== pr.base.sha ||
      member.isDraft !== pr.isDraft ||
      member.state !== 'open' ||
      member.mergedAt !== null
    )
      return null
  }
  return ['pull_requests']
}
