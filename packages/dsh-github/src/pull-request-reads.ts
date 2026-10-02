import { property } from './contracts.js'
import type { APIReader } from './contracts.js'
import { includesPR } from './pull-request-types.js'
import type { PRArguments } from './pull-request-types.js'
import {
  validatePRArguments,
  failPR,
  recordPR,
  arrayPR,
  boolPR,
  textPR,
  numberPR,
  shaPR,
  repoPR,
  restPullPR,
  restPagePR,
  connectionPR,
  prPath,
  getPR,
} from './pull-request-contracts.js'

const pageInfo = 'totalCount pageInfo { hasNextPage endCursor }'
const commentFields = 'id body url createdAt author { login }'
const threadFields = `id isResolved isOutdated path line startLine diffSide startDiffSide comments(first:$commentsLimit) { ${pageInfo} nodes { ${commentFields} } }`
const threadsDocument = `query PullRequestThreads($owner:String!,$repo:String!,$pullNumber:Int!,$limit:Int!,$cursor:String,$commentsLimit:Int!) {
  repository(owner:$owner,name:$repo) { id nameWithOwner pullRequest(number:$pullNumber) {
    id number url reviewThreads(first:$limit,after:$cursor) { ${pageInfo} nodes { ${threadFields} } }
  } }
}`
const threadDocument = `query PullRequestThreadComments($threadId:ID!,$commentsLimit:Int!,$commentsCursor:String) {
  node(id:$threadId) { ... on PullRequestReviewThread {
    id isResolved isOutdated path line startLine diffSide startDiffSide
    pullRequest { id number url repository { id nameWithOwner } }
    comments(first:$commentsLimit,after:$commentsCursor) { ${pageInfo} nodes { ${commentFields} } }
  } }
}`
function graphPull(input: unknown, args: PRArguments) {
  const value = recordPR(input)
  if (
    value.number !== args.pullNumber ||
    typeof value.id !== 'string' ||
    !value.id ||
    typeof value.url !== 'string' ||
    value.url.toLowerCase() !==
      `https://github.com/${args.owner}/${args.repo}/pull/${args.pullNumber}`.toLowerCase()
  )
    failPR()
  return { id: value.id, number: value.number, url: value.url }
}
function thread(input: unknown, commentsLimit: number) {
  const value = recordPR(input)
  if (
    typeof value.id !== 'string' ||
    !value.id ||
    !includesPR(['LEFT', 'RIGHT'], value.diffSide) ||
    !includesPR([null, 'LEFT', 'RIGHT'], value.startDiffSide)
  )
    failPR()
  for (const key of ['line', 'startLine'])
    if (
      value[key] !== null &&
      (typeof value[key] !== 'number' || !Number.isSafeInteger(value[key]) || value[key] < 1)
    )
      failPR()
  return {
    id: value.id,
    isResolved: boolPR(value.isResolved),
    isOutdated: boolPR(value.isOutdated),
    path: textPR(value.path),
    line: value.line,
    startLine: value.startLine,
    side: value.diffSide,
    startSide: value.startDiffSide,
    comments: connectionPR(
      value.comments,
      (input) => {
        const comment = recordPR(input)
        if (typeof comment.id !== 'string' || !comment.id) failPR()
        return {
          id: comment.id,
          body: textPR(comment.body),
          url: textPR(comment.url),
          createdAt: textPR(comment.createdAt),
          author:
            comment.author === null ? null : { login: textPR(recordPR(comment.author).login) },
        }
      },
      commentsLimit,
    ),
  }
}
export function filePR(input: unknown) {
  const value = recordPR(input)
  if (
    typeof value.filename !== 'string' ||
    !value.filename ||
    !includesPR(
      ['added', 'removed', 'modified', 'renamed', 'copied', 'changed', 'unchanged'],
      value.status,
    )
  )
    failPR()
  for (const key of ['additions', 'deletions', 'changes'])
    if (typeof value[key] !== 'number' || !Number.isSafeInteger(value[key]) || value[key] < 0)
      failPR()
  if (
    (value.patch !== undefined && typeof value.patch !== 'string') ||
    (value.previous_filename !== undefined && typeof value.previous_filename !== 'string')
  )
    failPR()
  return {
    path: value.filename,
    previousPath: value.previous_filename ?? null,
    status: value.status,
    additions: value.additions as number,
    deletions: value.deletions as number,
    changes: value.changes as number,
    patch: value.patch ?? null,
    patchAvailable: typeof value.patch === 'string' && value.patch.length > 0,
    patchCompleteness: 'unverified',
    sha: shaPR(value.sha),
  }
}
export function reviewPR(input: unknown, args: PRArguments) {
  const value = recordPR(input)
  const expected = `https://api.github.com/repos/${args.owner}/${args.repo}/pulls/${args.pullNumber}`
  if (
    typeof value.pull_request_url !== 'string' ||
    value.pull_request_url.toLowerCase() !== expected.toLowerCase() ||
    !includesPR(
      ['PENDING', 'COMMENTED', 'APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'],
      value.state,
    ) ||
    typeof value.id !== 'number' ||
    !Number.isSafeInteger(value.id) ||
    value.id < 1 ||
    typeof value.node_id !== 'string' ||
    !value.node_id ||
    typeof value.html_url !== 'string' ||
    value.html_url.toLowerCase() !==
      `https://github.com/${args.owner}/${args.repo}/pull/${args.pullNumber}#pullrequestreview-${value.id}`.toLowerCase()
  )
    failPR()
  return {
    id: value.node_id,
    databaseId: value.id,
    state: value.state,
    body: textPR(value.body),
    commitSha: shaPR(value.commit_id),
    url: textPR(value.html_url),
    submittedAt: textPR(value.submitted_at ?? (value.state === 'PENDING' ? null : undefined), true),
    author:
      value.user === null
        ? null
        : {
            login: textPR(recordPR(value.user).login),
            id: textPR(property(value.user, 'node_id')),
          },
  }
}
export function stackPR(input: unknown, args: PRArguments, { complete = false } = {}) {
  const value = recordPR(input)
  const number = numberPR(value.number)
  if (
    typeof value.id !== 'number' ||
    !Number.isSafeInteger(value.id) ||
    value.id < 1 ||
    typeof value.node_id !== 'string' ||
    !value.node_id ||
    typeof value.url !== 'string' ||
    value.url.toLowerCase() !==
      `${'https://api.github.com'}${prPath(args)}/stacks/${number}`.toLowerCase()
  )
    failPR()
  const members = arrayPR(value.pull_requests, 3000).map(recordPR)
  if (!members.length || new Set(members.map((pr) => pr.number)).size !== members.length) failPR()
  if (complete && members.length > 50) failPR('BOUND_EXCEEDED')
  const offset = ((args.membersPage ?? 1) - 1) * (args.limit ?? 20)
  const selected = complete ? members : members.slice(offset, offset + (args.limit ?? 20))
  const normalized = selected.map((pr) => {
    recordPR(pr)
    const head = recordPR(pr.head)
    if (complete) {
      recordPR(pr.base)
      for (const ref of [head, recordPR(pr.base)]) {
        const repository = recordPR(ref.repo)
        if (
          typeof repository.id !== 'number' ||
          !Number.isSafeInteger(repository.id) ||
          repository.id < 1 ||
          typeof repository.url !== 'string' ||
          repository.url.toLowerCase() !== `https://api.github.com${prPath(args)}`.toLowerCase()
        )
          failPR()
      }
      if (
        typeof pr.node_id !== 'string' ||
        !pr.node_id ||
        typeof pr.html_url !== 'string' ||
        pr.html_url.toLowerCase() !==
          `https://github.com/${args.owner}/${args.repo}/pull/${pr.number}`.toLowerCase()
      )
        failPR()
    }
    if (
      !includesPR(['open', 'closed'], pr.state) ||
      !Object.hasOwn(pr, 'merged_at') ||
      (pr.merged_at !== null && typeof pr.merged_at !== 'string')
    )
      failPR()
    return {
      ...(complete ? { id: pr.node_id } : {}),
      ...(typeof pr.title === 'string' ? { title: pr.title } : {}),
      ...(typeof pr.html_url === 'string' &&
      pr.html_url.toLowerCase() ===
        `https://github.com/${args.owner}/${args.repo}/pull/${pr.number}`.toLowerCase()
        ? { url: pr.html_url }
        : {}),
      number: numberPR(pr.number),
      state: pr.state,
      isDraft: boolPR(pr.draft),
      mergedAt: pr.merged_at,
      head: { ref: textPR(head.ref), sha: shaPR(head.sha) },
      ...(pr.base
        ? { base: { ref: textPR(property(pr.base, 'ref')), sha: shaPR(property(pr.base, 'sha')) } }
        : {}),
    }
  })
  return {
    id: value.node_id,
    databaseId: value.id,
    number,
    apiUrl: value.url,
    base: { ref: textPR(recordPR(value.base).ref) },
    open: boolPR(value.open),
    createdAt: textPR(value.created_at),
    pullRequests: {
      nodes: normalized,
      totalCount: members.length,
      pageInfo: {
        page: complete ? 1 : (args.membersPage ?? 1),
        hasNextPage: !complete && offset + selected.length < members.length,
        nextPage:
          !complete && offset + selected.length < members.length
            ? (args.membersPage ?? 1) + 1
            : null,
      },
    },
  }
}
export async function readPullRequest(
  operation: string,
  input: unknown,
  request: APIReader,
): Promise<Record<string, unknown>> {
  const args = validatePRArguments(operation, input)
  const root = prPath(args)
  const limit = args.limit ?? 20
  const page = args.page ?? 1
  const result = { repository: { nameWithOwner: `${args.owner}/${args.repo}` } }
  if (operation === 'listPullRequests') {
    const raw = arrayPR(
      await request(
        getPR(`${root}/pulls?state=${args.state ?? 'open'}&per_page=${limit}&page=${page}`),
      ),
      limit,
    )
    return {
      ...result,
      pullRequests: restPagePR(
        raw.map((pr) => restPullPR(pr, args)),
        args,
      ),
    }
  }
  if (operation === 'getPullRequestThreads') {
    const commentsLimit = args.commentsLimit ?? 20
    if (args.threadId) {
      const data = recordPR(
        await request({
          document: threadDocument,
          variables: {
            threadId: args.threadId,
            commentsLimit,
            commentsCursor: args.commentsCursor ?? null,
          },
        }),
      )
      const node = recordPR(data.node)
      if (node.id !== args.threadId) failPR()
      repoPR(recordPR(node.pullRequest).repository, args)
      return {
        ...result,
        pullRequest: graphPull(node.pullRequest, args),
        thread: thread(node, commentsLimit),
      }
    }
    const data = recordPR(
      await request({
        document: threadsDocument,
        variables: {
          owner: args.owner,
          repo: args.repo,
          pullNumber: args.pullNumber,
          limit,
          cursor: args.cursor ?? null,
          commentsLimit,
        },
      }),
    )
    const repository = repoPR(data.repository, args)
    const pullRequest = recordPR(property(data.repository, 'pullRequest'))
    return {
      repository,
      pullRequest: graphPull(pullRequest, args),
      threads: connectionPR(
        pullRequest.reviewThreads,
        (node) => thread(node, commentsLimit),
        limit,
      ),
    }
  }
  const rawPull = recordPR(await request(getPR(`${root}/pulls/${args.pullNumber}`)))
  const pullRequest = restPullPR(rawPull, args)
  if (operation === 'getPullRequest') return { repository: pullRequest.repository, pullRequest }
  if (operation === 'getPullRequestFiles') {
    const raw = arrayPR(
      await request(getPR(`${root}/pulls/${args.pullNumber}/files?per_page=${limit}&page=${page}`)),
      limit,
    )
    if (
      typeof rawPull.changed_files !== 'number' ||
      !Number.isSafeInteger(rawPull.changed_files) ||
      rawPull.changed_files < 0
    )
      failPR()
    return {
      repository: pullRequest.repository,
      pullRequest,
      files: restPagePR(raw.map(filePR), args, rawPull.changed_files),
      warnings: ['Patches may be unavailable or truncated. GitHub returns at most 3,000 files.'],
      ...(rawPull.changed_files > 3000
        ? { truncated: true, truncations: ['files: GitHub 3,000-file maximum'] }
        : {}),
    }
  }
  if (operation === 'getPullRequestReviews') {
    const raw = arrayPR(
      await request(
        getPR(`${root}/pulls/${args.pullNumber}/reviews?per_page=${limit}&page=${page}`),
      ),
      limit,
    )
    return {
      repository: pullRequest.repository,
      pullRequest,
      reviews: restPagePR(
        raw.map((review) => reviewPR(review, args)),
        args,
      ),
    }
  }
  if (operation === 'getPullRequestChecks') {
    const checksPage = args.checksPage ?? 1
    const statusesPage = args.statusesPage ?? 1
    const runs = recordPR(
      await request(
        getPR(
          `${root}/commits/${pullRequest.head.sha}/check-runs?filter=latest&per_page=${limit}&page=${checksPage}`,
        ),
      ),
    )
    const statuses = recordPR(
      await request(
        getPR(
          `${root}/commits/${pullRequest.head.sha}/status?per_page=${limit}&page=${statusesPage}`,
        ),
      ),
    )
    if (
      statuses.sha !== pullRequest.head.sha ||
      typeof runs.total_count !== 'number' ||
      !Number.isSafeInteger(runs.total_count) ||
      runs.total_count < 0 ||
      typeof statuses.total_count !== 'number' ||
      !Number.isSafeInteger(statuses.total_count) ||
      statuses.total_count < 0 ||
      !includesPR(['pending', 'success', 'failure'], statuses.state)
    )
      failPR()
    const checkRuns = arrayPR(runs.check_runs, limit).map((input) => {
      const run = recordPR(input)
      if (
        typeof run.id !== 'number' ||
        !Number.isSafeInteger(run.id) ||
        run.id < 1 ||
        run.head_sha !== pullRequest.head.sha ||
        !includesPR(
          ['queued', 'in_progress', 'completed', 'waiting', 'requested', 'pending'],
          run.status,
        ) ||
        !includesPR(
          [
            null,
            'action_required',
            'cancelled',
            'failure',
            'neutral',
            'success',
            'skipped',
            'stale',
            'timed_out',
            'startup_failure',
          ],
          run.conclusion,
        )
      )
        failPR()
      return {
        id: run.id,
        name: textPR(run.name),
        status: run.status,
        conclusion: run.conclusion,
        headSha: run.head_sha,
        detailsUrl: textPR(run.details_url, true),
        startedAt: textPR(run.started_at, true),
        completedAt: textPR(run.completed_at, true),
      }
    })
    const contexts = arrayPR(statuses.statuses, limit).map((input) => {
      const status = recordPR(input)
      if (
        typeof status.id !== 'number' ||
        !Number.isSafeInteger(status.id) ||
        status.id < 1 ||
        !includesPR(['pending', 'success', 'failure', 'error'], status.state)
      )
        failPR()
      return {
        id: status.id,
        context: textPR(status.context),
        state: status.state,
        description: textPR(status.description, true),
        targetUrl: textPR(status.target_url, true),
      }
    })
    return {
      repository: pullRequest.repository,
      pullRequest,
      headSha: pullRequest.head.sha,
      checkRuns: restPagePR(checkRuns, { limit, page: checksPage }, runs.total_count),
      statuses: {
        ...restPagePR(contexts, { limit, page: statusesPage }, statuses.total_count),
        state: statuses.state,
      },
      warnings: [
        'Check and status pages describe the observed head SHA, not an atomic readiness or merge decision.',
      ],
    }
  }
  if (operation === 'getPullRequestStack') {
    const raw = arrayPR(
      await request(
        getPR(`${root}/stacks?pull_request=${args.pullNumber}&per_page=${limit}&page=${page}`),
      ),
      limit,
    )
    const stacks = []
    for (const stack of raw) {
      const listed = stackPR(stack, args)
      if (
        !arrayPR(property(stack, 'pull_requests'), 3000).some(
          (member) => property(member, 'number') === args.pullNumber,
        )
      )
        failPR()
      // The list endpoint exposes minimal members; full detail supplies per-layer
      // base refs and display identities without inventing them from the chain.
      const detail = recordPR(await request(getPR(`${root}/stacks/${listed.number}`)))
      const normalized = stackPR(detail, args)
      if (
        normalized.id !== listed.id ||
        normalized.number !== listed.number ||
        !arrayPR(detail.pull_requests, 3000).some(
          (member) => property(member, 'number') === args.pullNumber,
        )
      )
        failPR('CONFLICT')
      stacks.push(normalized)
    }
    return {
      repository: pullRequest.repository,
      pullRequest,
      stacks: restPagePR(stacks, args),
      warnings: [
        'Native stacks are a public-preview feature. Requests use REST API 2026-03-10; membership does not imply merge readiness.',
      ],
    }
  }
  failPR('INVALID_ARGUMENT')
}
