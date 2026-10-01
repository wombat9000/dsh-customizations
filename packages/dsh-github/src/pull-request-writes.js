import { GitHubError } from './runtime.js'
import {
  validatePRArguments,
  safeExactPR,
  failPR,
  recordPR,
  arrayPR,
  boolPR,
  textPR,
  numberPR,
  shaPR,
  repoPR,
  restPullPR,
  connectionPR,
  prPath,
  getPR,
} from './pull-request-contracts.js'
import { filePR, reviewPR, stackPR } from './pull-request-reads.js'

const repositoryFields = 'id nameWithOwner url isArchived isDisabled viewerPermission'
const pullFields = `id number url title body updatedAt state isDraft viewerCanUpdate viewerDidAuthor
  headRefName baseRefName headRefOid baseRefOid changedFiles author { login ... on Node { id } }
  repository { id nameWithOwner } headRepository { id nameWithOwner }`
const pullDocument = `query PullRequestPreflight($owner:String!,$repo:String!,$pullNumber:Int!) {
  viewer { id login } repository(owner:$owner,name:$repo) { ${repositoryFields}
    pullRequest(number:$pullNumber) { ${pullFields}
      reviews(first:100,states:[PENDING]) { totalCount pageInfo { hasNextPage endCursor } nodes { id state author { login ... on Node { id } } } }
    }
  }
}`
const createDocument = `query CreatePullRequestPreflight($owner:String!,$repo:String!,$head:String!,$base:String!,$headQualified:String!,$baseQualified:String!) {
  viewer { id login } repository(owner:$owner,name:$repo) { ${repositoryFields}
    head:ref(qualifiedName:$headQualified) { id name prefix target { __typename ... on Commit { oid } } }
    base:ref(qualifiedName:$baseQualified) { id name prefix target { __typename ... on Commit { oid } } }
    pullRequests(first:100,states:[OPEN],headRefName:$head,baseRefName:$base) { totalCount pageInfo { hasNextPage endCursor } nodes { id number headRepository { id } } }
  }
}`
const draftDocuments = {
  true: `mutation ConvertPullRequestToDraft($input:ConvertPullRequestToDraftInput!) { convertPullRequestToDraft(input:$input) { pullRequest { ${pullFields} } } }`,
  false: `mutation MarkPullRequestReadyForReview($input:MarkPullRequestReadyForReviewInput!) { markPullRequestReadyForReview(input:$input) { pullRequest { ${pullFields} } } }`,
}
function actorPR(value) {
  recordPR(value)
  if (
    typeof value.id !== 'string' ||
    !value.id ||
    typeof value.login !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/.test(value.login)
  )
    failPR()
  return { id: value.id, login: value.login }
}
function authorPR(value) {
  recordPR(value)
  if (
    typeof value.id !== 'string' ||
    !value.id ||
    typeof value.login !== 'string' ||
    !value.login ||
    value.login.length > 100
  )
    failPR()
  return { id: value.id, login: value.login }
}
function repositoryPR(value, args, { requireWrite = true } = {}) {
  if (value === null) failPR('NOT_FOUND')
  const result = repoPR(value, args)
  if (
    typeof value.id !== 'string' ||
    !value.id ||
    typeof value.url !== 'string' ||
    value.url.toLowerCase() !== `https://github.com/${args.owner}/${args.repo}`.toLowerCase() ||
    !['ADMIN', 'MAINTAIN', 'WRITE', 'TRIAGE', 'READ', null].includes(value.viewerPermission)
  )
    failPR()
  const repository = {
    ...result,
    url: value.url,
    isArchived: boolPR(value.isArchived),
    isDisabled: boolPR(value.isDisabled),
    viewerPermission: value.viewerPermission,
  }
  // Creation/stack edits require known repository write permission. Authors can
  // update their own PRs, and readers can review; GitHub decides token permissions.
  if (
    repository.isArchived ||
    repository.isDisabled ||
    (requireWrite && !['ADMIN', 'MAINTAIN', 'WRITE'].includes(repository.viewerPermission))
  )
    failPR('PERMISSION_DENIED')
  return repository
}
function graphPullPR(value, args, { pending = false } = {}) {
  if (value === null) failPR('NOT_FOUND')
  recordPR(value)
  const repository = repoPR(value.repository, args)
  if (
    value.number !== args.pullNumber ||
    typeof value.id !== 'string' ||
    !value.id ||
    typeof value.url !== 'string' ||
    value.url.toLowerCase() !==
      `https://github.com/${args.owner}/${args.repo}/pull/${args.pullNumber}`.toLowerCase() ||
    !['OPEN', 'CLOSED', 'MERGED'].includes(value.state) ||
    typeof value.headRefName !== 'string' ||
    !value.headRefName ||
    typeof value.baseRefName !== 'string' ||
    !value.baseRefName ||
    !Number.isSafeInteger(value.changedFiles) ||
    value.changedFiles < 0
  )
    failPR()
  const result = {
    id: value.id,
    number: value.number,
    url: value.url,
    repository,
    title: textPR(value.title),
    body: textPR(value.body),
    updatedAt: textPR(value.updatedAt),
    state: value.state,
    isDraft: boolPR(value.isDraft),
    viewerCanUpdate: boolPR(value.viewerCanUpdate),
    viewerDidAuthor: boolPR(value.viewerDidAuthor),
    author: value.author === null ? null : authorPR(value.author),
    head: {
      ref: value.headRefName,
      sha: shaPR(value.headRefOid),
      repository:
        value.headRepository === null
          ? null
          : {
              id: textPR(recordPR(value.headRepository).id),
              nameWithOwner: textPR(value.headRepository.nameWithOwner),
            },
    },
    base: { ref: value.baseRefName, sha: shaPR(value.baseRefOid), repository },
    changedFiles: value.changedFiles,
  }
  if (pending) {
    const reviews = connectionPR(
      value.reviews,
      (review) => {
        recordPR(review)
        if (typeof review.id !== 'string' || !review.id || review.state !== 'PENDING') failPR()
        return {
          id: review.id,
          state: review.state,
          author: review.author === null ? null : authorPR(review.author),
        }
      },
      100,
    )
    if (reviews.pageInfo.hasNextPage || reviews.totalCount !== reviews.nodes.length)
      failPR('BOUND_EXCEEDED')
    result.pendingReviews = reviews.nodes
  }
  return result
}
async function observePull(args, request, permissions) {
  const data = recordPR(
    await request({
      document: pullDocument,
      variables: {
        owner: args.owner,
        repo: args.repo,
        pullNumber: args.pullNumber,
      },
    }),
  )
  return {
    actor: actorPR(data.viewer),
    repository: repositoryPR(data.repository, args, permissions),
    pullRequest: graphPullPR(data.repository.pullRequest, args, { pending: true }),
  }
}
function openPull(pr) {
  if (pr.state !== 'OPEN') failPR('CONFLICT')
}
function sameRepoPull(pr, repository) {
  if (
    !pr.head.repository ||
    pr.head.repository.id !== repository.id ||
    pr.head.repository.nameWithOwner.toLowerCase() !== repository.nameWithOwner.toLowerCase()
  )
    failPR('CONFLICT')
}
async function membership(args, number, request, cache = new Map()) {
  const raw = arrayPR(
    await request(getPR(`${prPath(args)}/stacks?pull_request=${number}&per_page=2&page=1`)),
    2,
  )
  if (raw.length > 1) failPR('BOUND_EXCEEDED')
  if (!raw.length) return null
  const found = stackPR(raw[0], { ...args, limit: 50 })
  if (!arrayPR(raw[0].pull_requests, 3000).some((pr) => pr.number === number)) failPR()
  const detail =
    cache.get(found.id) ??
    stackPR(await request(getPR(`${prPath(args)}/stacks/${found.number}`)), args, {
      complete: true,
    })
  if (
    detail.id !== found.id ||
    detail.number !== found.number ||
    detail.pullRequests.totalCount !== found.pullRequests.totalCount ||
    !detail.pullRequests.nodes.some((pr) => pr.number === number)
  )
    failPR('CONFLICT')
  if (found.pullRequests.pageInfo.hasNextPage) failPR('BOUND_EXCEEDED')
  for (let index = 0; index < found.pullRequests.nodes.length; index++) {
    const listed = found.pullRequests.nodes[index]
    const current = detail.pullRequests.nodes[index]
    if (
      listed.number !== current.number ||
      listed.head.sha !== current.head.sha ||
      listed.head.ref !== current.head.ref ||
      listed.isDraft !== current.isDraft ||
      listed.state !== current.state ||
      listed.mergedAt !== current.mergedAt
    )
      failPR('CONFLICT')
  }
  cache.set(found.id, detail)
  return detail
}
function ordered(prs) {
  for (let index = 1; index < prs.length; index++) {
    if (
      prs[index].base.ref !== prs[index - 1].head.ref ||
      prs[index].base.sha !== prs[index - 1].head.sha
    )
      failPR('CONFLICT')
  }
}
function equalStackMember(member, pr) {
  if (
    member.id !== pr.id ||
    member.number !== pr.number ||
    member.isDraft !== pr.isDraft ||
    member.state !== pr.state.toLowerCase() ||
    member.mergedAt !== null ||
    member.head.ref !== pr.head.ref ||
    member.head.sha !== pr.head.sha ||
    !member.base ||
    member.base.ref !== pr.base.ref ||
    member.base.sha !== pr.base.sha
  )
    failPR('CONFLICT')
}
// Parse every hunk and verify both hunk counts and whole-file change counts. A
// missing, shortened or unsupported patch cannot establish a valid inline target.
function patchLines(file) {
  if (!file.patchAvailable || file.changes !== file.additions + file.deletions) failPR('CONFLICT')
  const lines = file.patch.split('\n')
  if (lines.at(-1) === '') lines.pop()
  const locations = { LEFT: new Map(), RIGHT: new Map() }
  let oldLine = 0,
    newLine = 0,
    oldRemaining = 0,
    newRemaining = 0,
    hunk = -1
  let additions = 0,
    deletions = 0,
    previousContent = false
  for (const line of lines) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/.exec(line)
    if (header) {
      if (oldRemaining !== 0 || newRemaining !== 0) failPR('CONFLICT')
      const previousOldEnd = oldLine,
        previousNewEnd = newLine
      oldLine = Number(header[1])
      oldRemaining = header[2] === undefined ? 1 : Number(header[2])
      newLine = Number(header[3])
      newRemaining = header[4] === undefined ? 1 : Number(header[4])
      if (hunk >= 0 && (oldLine < previousOldEnd || newLine < previousNewEnd)) failPR('CONFLICT')
      if (
        ![oldLine, oldRemaining, newLine, newRemaining].every(Number.isSafeInteger) ||
        (oldRemaining && oldLine < 1) ||
        (newRemaining && newLine < 1)
      )
        failPR('CONFLICT')
      hunk++
      previousContent = false
      continue
    }
    if (line === '\\ No newline at end of file' && previousContent) {
      previousContent = false
      continue
    }
    if (hunk < 0) failPR('CONFLICT')
    const prefix = line[0]
    if (prefix === ' ' || prefix === '-') {
      if (oldRemaining < 1) failPR('CONFLICT')
      if (prefix === '-') {
        locations.LEFT.set(oldLine, hunk)
        deletions++
      }
      oldLine++
      oldRemaining--
    }
    if (prefix === ' ' || prefix === '+') {
      if (newRemaining < 1) failPR('CONFLICT')
      locations.RIGHT.set(newLine, hunk)
      if (prefix === '+') additions++
      newLine++
      newRemaining--
    }
    if (![' ', '-', '+'].includes(prefix)) failPR('CONFLICT')
    previousContent = true
  }
  if (
    hunk < 0 ||
    oldRemaining ||
    newRemaining ||
    additions !== file.additions ||
    deletions !== file.deletions
  )
    failPR('CONFLICT')
  return locations
}
async function inlineFiles(args, pr, request) {
  if (pr.changedFiles > 50) failPR('BOUND_EXCEEDED')
  const root = prPath(args)
  const actual = restPullPR(await request(getPR(`${root}/pulls/${args.pullNumber}`)), args)
  if (
    actual.id !== pr.id ||
    actual.head.sha !== pr.head.sha ||
    actual.base.sha !== pr.base.sha ||
    actual.changedFiles !== pr.changedFiles
  )
    failPR('CONFLICT')
  const files = arrayPR(
    await request(getPR(`${root}/pulls/${args.pullNumber}/files?per_page=50&page=1`)),
    50,
  ).map(filePR)
  if (
    files.length !== pr.changedFiles ||
    new Set(files.map((file) => file.path)).size !== files.length
  )
    failPR('BOUND_EXCEEDED')
  const commentedPaths = new Set(args.comments.map((comment) => comment.path))
  const parsed = new Map(
    files
      .filter((file) => commentedPaths.has(file.path))
      .map((file) => [file.path, patchLines(file)]),
  )
  for (const comment of args.comments) {
    const locations = parsed.get(comment.path)?.[comment.side]
    if (!locations || !locations.has(comment.line)) failPR('CONFLICT')
    const start = comment.startLine ?? comment.line
    if (comment.line - start > 10000) failPR('BOUND_EXCEEDED')
    for (let line = start; line <= comment.line; line++)
      if (locations.get(line) !== locations.get(comment.line)) failPR('CONFLICT')
  }
  return files.map((file) => ({ ...file, patchCompleteness: 'verified-change-and-hunk-counts' }))
}
export async function preflightPullRequest(operation, input, request) {
  const args = validatePRArguments(operation, input)
  const root = prPath(args)
  let observed, payload, descriptor, targets, change
  if (operation === 'createPullRequest') {
    const data = recordPR(
      await request({
        document: createDocument,
        variables: {
          owner: args.owner,
          repo: args.repo,
          head: args.head,
          base: args.base,
          headQualified: `refs/heads/${args.head}`,
          baseQualified: `refs/heads/${args.base}`,
        },
      }),
    )
    const actor = actorPR(data.viewer)
    const repository = repositoryPR(data.repository, args)
    const ref = (value, expected) => {
      if (value === null) failPR('NOT_FOUND')
      recordPR(value)
      recordPR(value.target)
      if (
        typeof value.id !== 'string' ||
        !value.id ||
        value.name !== expected ||
        value.prefix !== 'refs/heads/' ||
        value.target.__typename !== 'Commit'
      )
        failPR()
      return { id: value.id, name: value.name, prefix: value.prefix, sha: shaPR(value.target.oid) }
    }
    const head = ref(data.repository.head, args.head)
    const base = ref(data.repository.base, args.base)
    if (head.sha === base.sha) failPR('CONFLICT')
    const existing = connectionPR(
      data.repository.pullRequests,
      (pr) => {
        recordPR(pr)
        if (typeof pr.id !== 'string' || !pr.id) failPR()
        const candidateRepository = recordPR(pr.headRepository)
        if (typeof candidateRepository.id !== 'string' || !candidateRepository.id) failPR()
        return { id: pr.id, number: numberPR(pr.number), headRepositoryId: candidateRepository.id }
      },
      100,
    )
    // Bare ref-name filters also match incoming forks. Only the same head
    // repository constitutes a duplicate; absence requires complete candidates.
    if (existing.nodes.some((pr) => pr.headRepositoryId === repository.id)) failPR('ALREADY_EXISTS')
    if (existing.pageInfo.hasNextPage || existing.totalCount !== existing.nodes.length)
      failPR('BOUND_EXCEEDED')
    observed = { actor, repository, head, base, existing }
    payload = { title: args.title, body: args.body, head: args.head, base: args.base, draft: true }
    descriptor = { path: `${root}/pulls`, method: 'POST', body: payload }
    targets = { repository, head, base }
    change = { before: null, after: payload }
  } else if (['updatePullRequest', 'submitPullRequestReview'].includes(operation)) {
    observed = await observePull(args, request, { requireWrite: false })
    const pr = observed.pullRequest
    openPull(pr)
    targets = { repository: observed.repository, pullRequest: pr }
    if (operation === 'updatePullRequest') {
      if (!pr.viewerCanUpdate) failPR('PERMISSION_DENIED')
      if (args.draft !== undefined) {
        if (args.draft === pr.isDraft) failPR('ALREADY_EXISTS')
        payload = { pullRequestId: pr.id }
        descriptor = { document: draftDocuments[String(args.draft)], variables: { input: payload } }
        change = { before: { draft: pr.isDraft }, after: { draft: args.draft } }
      } else {
        payload = Object.fromEntries(
          ['title', 'body']
            .filter((key) => Object.hasOwn(args, key))
            .map((key) => [key, args[key]]),
        )
        descriptor = { path: `${root}/pulls/${args.pullNumber}`, method: 'PATCH', body: payload }
        change = {
          before: Object.fromEntries(Object.keys(payload).map((key) => [key, pr[key]])),
          after: payload,
        }
        if (Object.keys(payload).every((key) => payload[key] === pr[key])) failPR('ALREADY_EXISTS')
      }
    } else {
      if (
        pr.head.sha !== args.expectedHeadSha ||
        (args.event !== 'COMMENT' &&
          (pr.isDraft || pr.viewerDidAuthor || pr.author?.id === observed.actor.id))
      )
        failPR('CONFLICT')
      if (pr.pendingReviews.some((review) => review.author?.id === observed.actor.id))
        failPR('CONFLICT')
      if (args.comments) observed.files = await inlineFiles(args, pr, request)
      payload = {
        commit_id: args.expectedHeadSha,
        body: args.body,
        event: args.event,
        ...(args.comments
          ? {
              comments: args.comments.map((comment) => ({
                path: comment.path,
                body: comment.body,
                line: comment.line,
                side: comment.side,
                ...(comment.startLine !== undefined
                  ? { start_line: comment.startLine, start_side: comment.startSide }
                  : {}),
              })),
            }
          : {}),
      }
      descriptor = {
        path: `${root}/pulls/${args.pullNumber}/reviews`,
        method: 'POST',
        body: payload,
      }
      change = { before: null, after: payload }
    }
  } else if (['createPullRequestStack', 'addPullRequestToStack'].includes(operation)) {
    const initialNumbers =
      operation === 'createPullRequestStack' ? args.pullNumbers : [args.stackPullNumber]
    const first = await observePull({ ...args, pullNumber: initialNumbers[0] }, request)
    observed = {
      actor: first.actor,
      repository: first.repository,
      pullRequests: [],
      memberships: [],
    }
    const cache = new Map([[initialNumbers[0], first]])
    const observe = async (number) => {
      const item =
        cache.get(number) ?? (await observePull({ ...args, pullNumber: number }, request))
      if (
        item.actor.id !== first.actor.id ||
        item.actor.login !== first.actor.login ||
        JSON.stringify(item.repository) !== JSON.stringify(first.repository)
      )
        failPR('CONFLICT')
      cache.set(number, item)
      openPull(item.pullRequest)
      sameRepoPull(item.pullRequest, first.repository)
      return item.pullRequest
    }
    const stackCache = new Map()
    let numbers,
      existingStack = null
    if (operation === 'addPullRequestToStack') {
      existingStack = await membership(args, args.stackPullNumber, request, stackCache)
      if (!existingStack) failPR('NOT_FOUND')
      if (!existingStack.open) failPR('CONFLICT')
      numbers = existingStack.pullRequests.nodes.map((pr) => pr.number)
      if (numbers.includes(args.pullNumber)) failPR('ALREADY_EXISTS')
      if (numbers.length >= 50) failPR('BOUND_EXCEEDED')
      numbers.push(args.pullNumber)
      observed.stack = existingStack
    } else numbers = [...args.pullNumbers]
    for (const number of numbers) {
      const pr = await observe(number)
      const member = await membership(args, number, request, stackCache)
      if (existingStack && number !== args.pullNumber) {
        if (!member || JSON.stringify(member) !== JSON.stringify(existingStack)) failPR('CONFLICT')
        equalStackMember(
          existingStack.pullRequests.nodes.find((entry) => entry.number === number),
          pr,
        )
      } else if (member) failPR('ALREADY_EXISTS')
      observed.pullRequests.push(pr)
      observed.memberships.push({
        pullNumber: number,
        stack: member
          ? {
              id: member.id,
              number: member.number,
              pullNumbers: member.pullRequests.nodes.map((entry) => entry.number),
            }
          : null,
      })
    }
    ordered(observed.pullRequests)
    payload = {
      pull_requests: operation === 'createPullRequestStack' ? numbers : [args.pullNumber],
    }
    descriptor = {
      path:
        operation === 'createPullRequestStack'
          ? `${root}/stacks`
          : `${root}/stacks/${existingStack.number}/add`,
      method: 'POST',
      body: payload,
    }
    targets = {
      repository: observed.repository,
      ...(existingStack ? { stack: existingStack } : {}),
      pullRequests: observed.pullRequests,
    }
    change = {
      before: existingStack?.pullRequests.nodes.map((pr) => pr.number) ?? null,
      after: numbers,
    }
  } else failPR('INVALID_ARGUMENT')
  safeExactPR({ observed, payload, targets, change })
  return {
    actor: observed.actor,
    snapshot: observed,
    mutation: operation,
    payload,
    targets,
    change,
    request: descriptor,
  }
}
function confirmPullResource(operation, prepared, data) {
  if (!prepared || prepared.mutation !== operation) failPR()
  const repository = prepared.snapshot.repository
  const [owner, repo] = repository.nameWithOwner.split('/')
  const args = { owner, repo, pullNumber: prepared.targets.pullRequest?.number }
  let resource
  if (operation === 'createPullRequest') {
    resource = restPullPR(data, args)
    if (data.base.repo.node_id !== repository.id || data.head.repo?.node_id !== repository.id)
      failPR()
    if (
      !resource.isDraft ||
      resource.state !== 'open' ||
      resource.title !== prepared.payload.title ||
      (resource.body ?? '') !== prepared.payload.body ||
      resource.head.ref !== prepared.payload.head ||
      resource.base.ref !== prepared.payload.base ||
      resource.head.sha !== prepared.snapshot.head.sha ||
      resource.base.sha !== prepared.snapshot.base.sha ||
      resource.head.repository?.nameWithOwner.toLowerCase() !==
        repository.nameWithOwner.toLowerCase()
    )
      failPR()
  } else if (operation === 'updatePullRequest') {
    const draft = prepared.change.after.draft
    if (draft !== undefined) {
      const container = recordPR(
        recordPR(data)[draft ? 'convertPullRequestToDraft' : 'markPullRequestReadyForReview'],
      )
      resource = graphPullPR(container.pullRequest, args)
      if (
        resource.isDraft !== draft ||
        resource.repository.id !== repository.id ||
        resource.title !== prepared.snapshot.pullRequest.title ||
        resource.body !== prepared.snapshot.pullRequest.body
      )
        failPR()
    } else {
      resource = restPullPR(data, args)
      for (const [key, value] of Object.entries(prepared.payload))
        if ((resource[key] ?? '') !== value) failPR()
      if (
        resource.isDraft !== prepared.snapshot.pullRequest.isDraft ||
        data.base.repo.node_id !== repository.id
      )
        failPR()
    }
    if (
      resource.id !== prepared.targets.pullRequest.id ||
      resource.head.sha !== prepared.snapshot.pullRequest.head.sha ||
      resource.base.sha !== prepared.snapshot.pullRequest.base.sha ||
      resource.head.ref !== prepared.snapshot.pullRequest.head.ref ||
      resource.base.ref !== prepared.snapshot.pullRequest.base.ref ||
      resource.state.toLowerCase() !== 'open'
    )
      failPR()
  } else if (operation === 'submitPullRequestReview') {
    resource = reviewPR(data, args)
    const states = {
      COMMENT: 'COMMENTED',
      APPROVE: 'APPROVED',
      REQUEST_CHANGES: 'CHANGES_REQUESTED',
    }
    if (
      resource.state !== states[prepared.payload.event] ||
      resource.commitSha !== prepared.payload.commit_id ||
      resource.body !== prepared.payload.body ||
      resource.author?.id !== prepared.actor.id ||
      !resource.submittedAt
    )
      failPR()
  } else if (['createPullRequestStack', 'addPullRequestToStack'].includes(operation)) {
    resource = stackPR(data, args, { complete: true })
    if (
      !resource.open ||
      resource.pullRequests.nodes.length !== prepared.change.after.length ||
      resource.pullRequests.nodes.some((pr, index) => pr.number !== prepared.change.after[index])
    )
      failPR()
    if (
      operation === 'addPullRequestToStack' &&
      (resource.id !== prepared.snapshot.stack.id ||
        resource.number !== prepared.snapshot.stack.number)
    )
      failPR()
    for (let index = 0; index < resource.pullRequests.nodes.length; index++)
      equalStackMember(resource.pullRequests.nodes[index], prepared.snapshot.pullRequests[index])
    if (resource.base.ref !== prepared.snapshot.pullRequests[0].base.ref) failPR()
  } else failPR('INVALID_ARGUMENT')
  return safeExactPR(resource)
}
export function confirmPullRequest(operation, prepared, data) {
  try {
    return confirmPullResource(operation, prepared, data)
  } catch (error) {
    if (error instanceof GitHubError) throw error
    failPR()
  }
}
