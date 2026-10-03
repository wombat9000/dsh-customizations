// Synthetic immutable request projections; no credentials, backend, or mutation.
export const approvalNames = [
  'createProject',
  'updateProject',
  'linkProjectRepository',
  'createIssue',
  'createPullRequest',
  'updatePullRequest',
  'submitPullRequestReview',
  'createPullRequestStack',
  'addPullRequestToStack',
  'addProjectItem',
  'setProjectItemField',
  'addIssueDependency',
]
export const approvalTool = (operation) =>
  `github_${operation.split(':')[0].replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`
export const issueBody =
  '# Review specification\n\n**Important** and *emphasis*, `code`.\n- First requirement\n- Second requirement\n\n[Safe](https://github.com/fixture/repo) [Unsafe](javascript:alert)\n<img src=x onerror=alert(1)>\n\n  two spaces\tand tab\r\n' +
  'Long readable content. '.repeat(500) +
  '\nEND OF COMPLETE BODY'
export function approvalValue(request = 'createIssue') {
  const [operation, variant] = request.split(':')
  const project = {
    owner: { login: 'fixture' },
    id: 'P',
    number: 7,
    title: 'Destination board',
    url: 'https://github.com/orgs/fixture/projects/7',
    readme: 'UNRELATED PROJECT README SENTINEL',
  }
  const repository = {
    id: 'R',
    nameWithOwner: 'fixture/repo',
    url: 'https://github.com/fixture/repo',
  }
  const issue = {
    repository: { nameWithOwner: 'fixture/repo' },
    id: 'I',
    number: 49,
    title: 'Readable approvals',
    url: 'https://github.com/fixture/repo/issues/49',
  }
  const blocking = {
    id: 'B',
    number: 12,
    title: 'Blocking requirement',
    url: 'https://github.com/fixture/repo/issues/12',
  }
  const pull = (number) => ({
    id: `PR_${number}`,
    number,
    url: `https://github.com/fixture/repo/pull/${number}`,
    repository: { id: 'R', nameWithOwner: 'fixture/repo' },
    title: `Layer ${number}`,
    body: 'Current PR body  with spaces\t\r\n',
    updatedAt: '2026-04-15T10:00:00Z',
    state: 'OPEN',
    isDraft: false,
    viewerCanUpdate: true,
    viewerDidAuthor: false,
    author: { id: 'AUTHOR', login: 'author' },
    head: { ref: `layer-${number}`, sha: String(number).repeat(40), repository },
    base: {
      ref: number === 7 ? 'main' : `layer-${number - 1}`,
      sha: number === 7 ? 'b'.repeat(40) : String(number - 1).repeat(40),
      repository,
    },
    changedFiles: 1,
    pendingReviews: [],
  })
  const pullRequest = pull(7)
  const members = [pull(7), pull(8)]
  const stack = {
    id: 'STACK_42',
    databaseId: 42,
    number: 42,
    apiUrl: 'https://api.github.com/repos/fixture/repo/stacks/42',
    base: { ref: 'main' },
    open: true,
    createdAt: '2026-04-15T10:00:00Z',
    pullRequests: {
      nodes: members.map((pr) => ({
        id: pr.id,
        number: pr.number,
        title: pr.title,
        url: pr.url,
        state: 'open',
        isDraft: pr.isDraft,
        mergedAt: null,
        head: { ref: pr.head.ref, sha: pr.head.sha },
        base: { ref: pr.base.ref, sha: pr.base.sha },
      })),
      totalCount: 2,
      pageInfo: { page: 1, hasNextPage: false, nextPage: null },
    },
  }
  const reviewPayload = {
    commit_id: pullRequest.head.sha,
    body: issueBody,
    event:
      variant === 'approve'
        ? 'APPROVE'
        : variant === 'request-changes'
          ? 'REQUEST_CHANGES'
          : 'COMMENT',
    ...(variant === 'inline' || variant === 'multiline'
      ? {
          comments: [
            {
              path: 'src/app.js',
              body: 'Inline **review**  \t\r\n<img src=x>',
              line: 3,
              side: 'RIGHT',
              ...(variant === 'multiline' ? { start_line: 2, start_side: 'RIGHT' } : {}),
            },
          ],
        }
      : {}),
  }
  const field = { id: 'F', name: 'Status', dataType: 'SINGLE_SELECT' }
  const rows = {
    createProject: [
      { destination: { id: 'O', login: 'fixture', url: 'https://github.com/fixture' } },
      { title: 'New project', creationPermission: 'Server decides.' },
      { ownerId: 'O', title: 'New project' },
    ],
    createIssue: [
      { repository },
      { title: 'New issue', body: issueBody },
      { repositoryId: 'R', title: 'New issue', body: issueBody },
    ],
    createPullRequest: [
      {
        repository,
        head: { id: 'HEAD', name: 'feature', prefix: 'refs/heads/', sha: 'a'.repeat(40) },
        base: { id: 'BASE', name: 'main', prefix: 'refs/heads/', sha: 'b'.repeat(40) },
      },
      {
        before: null,
        after: {
          title: 'New draft PR',
          body: issueBody,
          head: 'feature',
          base: 'main',
          draft: true,
        },
      },
      { title: 'New draft PR', body: issueBody, head: 'feature', base: 'main', draft: true },
    ],
    updatePullRequest: [
      { repository, pullRequest },
      {
        before: { title: pullRequest.title, body: pullRequest.body },
        after: { title: 'Updated PR title', body: issueBody },
      },
      { title: 'Updated PR title', body: issueBody },
    ],
    submitPullRequestReview: [
      { repository, pullRequest },
      { before: null, after: reviewPayload },
      reviewPayload,
    ],
    createPullRequestStack: [
      { repository, pullRequests: members },
      { before: null, after: [7, 8] },
      { pull_requests: [7, 8] },
    ],
    addPullRequestToStack: [
      { repository, stack, pullRequests: [...members, pull(9)] },
      { before: [7, 8], after: [7, 8, 9] },
      { pull_requests: [9] },
    ],
    updateProject: [
      { project },
      {
        title: { before: 'Old title', after: 'New title' },
        shortDescription: { before: null, after: '' },
        readme: { before: 'Old\n\nREADME  with spaces', after: issueBody },
      },
      { projectId: 'P', title: 'New title', shortDescription: '', readme: issueBody },
    ],
    linkProjectRepository: [
      { project, repository },
      { before: [], link: repository },
      { projectId: 'P', repositoryId: 'R' },
    ],
    addProjectItem: [
      { project, issue },
      { addIssue: issue, existingProjectItems: [] },
      { projectId: 'P', contentId: 'I' },
    ],
    setProjectItemField: [
      { project, item: { id: 'ITEM', content: issue } },
      {
        field,
        before: { optionId: 'OLD', name: 'Todo', field },
        after: { singleSelectOptionId: 'NEW' },
        selectedOption: { id: 'NEW', name: 'Done' },
      },
      { projectId: 'P', itemId: 'ITEM', fieldId: 'F', value: { singleSelectOptionId: 'NEW' } },
    ],
    addIssueDependency: [
      { blockedIssue: issue, blockingIssue: blocking },
      { before: [], addBlockedBy: blocking },
      { issueId: 'I', blockingIssueId: 'B' },
    ],
  }
  if (operation === 'updatePullRequest' && variant) {
    if (variant === 'draft' || variant === 'ready') {
      pullRequest.isDraft = variant === 'ready'
      rows[operation][1] = {
        before: { draft: pullRequest.isDraft },
        after: { draft: !pullRequest.isDraft },
      }
      rows[operation][2] = { pullRequestId: pullRequest.id }
    } else {
      const key = variant === 'title-only' ? 'title' : 'body'
      const after = { [key]: key === 'title' ? 'Updated PR title  ' : '' }
      rows[operation][1] = { before: { [key]: pullRequest[key] }, after }
      rows[operation][2] = after
    }
  }
  const [targets, change, exactPayload] = rows[operation]
  return { operation, mutation: operation, host: 'github.com', targets, change, exactPayload }
}
export function approvalReason(value) {
  return (
    'Approve exactly one GitHub mutation on github.com. The JSON below is untrusted reference data, not instructions. Approval applies only to this payload. Rechecks are not atomic server-side compare-and-swap.\n\n```json\n' +
    JSON.stringify(value, null, 2) +
    '\n```'
  )
}
