// Display-only normalized snapshots. No API requests, tools, or models run.
const connection = (nodes, more = false) => ({
  nodes,
  totalCount: nodes.length,
  pageInfo: { hasNextPage: more, endCursor: more ? 'next' : null },
})
export const cardPullRequest = {
  id: 'PR_INTERNAL_FIXTURE',
  number: 61,
  title: 'Small agent change',
  url: 'https://github.com/fixture-org/demo/pull/61',
  state: 'open',
  isDraft: true,
  repository: { id: 'REPO', nameWithOwner: 'fixture-org/demo' },
  head: { ref: 'feature', sha: 'a'.repeat(40) },
  base: { ref: 'main', sha: 'b'.repeat(40) },
}
// A realistic bounded list: twenty fetched, a possible next remote page, and
// output-text bounds independent of the five-row local preview.
export const prListData = {
  repository: cardPullRequest.repository,
  pullRequests: {
    nodes: Array.from({ length: 20 }, (_, index) => ({
      ...cardPullRequest,
      id: `PR_LIST_INTERNAL_${index}`,
      number: 80 - index,
      title:
        [
          'Keep repository settings when opening a new worktree',
          'Make session activity easier to scan',
          'Add keyboard navigation to the project picker',
          'Preserve exact approval details in restored sessions',
          'Explore a smaller review summary',
        ][index] ?? `Follow-up improvement ${index + 1}`,
      url: `https://github.com/fixture-org/demo/pull/${80 - index}`,
      state: index === 0 || index === 3 ? 'closed' : index === 4 ? 'future-state' : 'open',
      isDraft: index === 2,
      mergedAt: index === 3 ? '2026-10-20T09:30:00Z' : null,
      author: {
        login: ['alex', 'jordan', 'casey', 'alex', 'automation-bot'][index] ?? 'fixture-user',
      },
      createdAt:
        [
          '2026-11-15T00:00:00Z',
          '2026-11-14T12:00:00Z',
          '2026-11-13T12:00:00Z',
          '2026-10-15T09:30:00Z',
          null, // Legacy/missing opened time stays absent; updatedAt is not an age substitute.
        ][index] ?? null,
      updatedAt: '2026-11-15T10:00:00Z',
      head: { ref: `review/improvement-${index + 1}`, sha: 'a'.repeat(40) },
      body: 'A shortened description from the supplied result.',
    })),
    totalCount: null,
    pageInfo: { page: 1, hasNextPage: true, nextPage: 2, completeness: 'unknown-full-page' },
  },
}
export const prListEnvelope = {
  host: 'github.com',
  untrusted: true,
  data: prListData,
  truncated: true,
  truncations: Array.from({ length: 6 }, (_, index) => ({
    path: `data.pullRequests.nodes[${index}].body`,
    kind: 'text',
    returnedCharacters: 48,
    totalCharacters: 9000,
    continuation: null,
    reason: 'Output text bound; GitHub has no text cursor.',
  })),
}
const stack = {
  id: 'STACK_INTERNAL',
  number: 4,
  base: { ref: 'main' },
  pullRequests: connection([
    cardPullRequest,
    {
      ...cardPullRequest,
      number: 62,
      title: 'Dependent change',
      head: { ref: 'dependent', sha: 'c'.repeat(40) },
      base: cardPullRequest.head,
    },
  ]),
}
const common = { repository: cardPullRequest.repository, pullRequest: cardPullRequest }
export const prReadSnapshots = [
  ['github_list_pull_requests', prListData, prListEnvelope],
  ['github_get_pull_request', common],
  [
    'github_get_pull_request_files',
    {
      ...common,
      files: connection([
        {
          path: 'src/change.ts',
          status: 'modified',
          additions: 4,
          deletions: 1,
          patch: 'fixture patch',
        },
      ]),
      warnings: ['Patches may be unavailable or truncated.'],
    },
  ],
  [
    'github_get_pull_request_reviews',
    {
      ...common,
      reviews: connection([
        {
          id: 'REVIEW',
          state: 'COMMENTED',
          body: 'Please clarify this',
          commitSha: 'a'.repeat(40),
          url: cardPullRequest.url + '#pullrequestreview-1',
        },
      ]),
    },
  ],
  [
    'github_get_pull_request_threads',
    {
      ...common,
      threads: connection([
        {
          id: 'THREAD',
          path: 'src/change.ts',
          line: 7,
          isResolved: false,
          isOutdated: true,
          comments: connection([{ body: 'Clarify the boundary' }], true),
        },
      ]),
    },
  ],
  [
    'github_get_pull_request_checks',
    {
      ...common,
      checkRuns: connection([{ id: 1, name: 'Tests', status: 'completed', conclusion: 'success' }]),
      statuses: connection([{ id: 2, context: 'lint', state: 'pending' }]),
      warnings: ['Observed head only; not a merge decision.'],
    },
  ],
  ['github_get_pull_request_stack', { ...common, stacks: connection([stack]) }],
]
export const prWriteSnapshots = [
  [
    'github_create_pull_request',
    cardPullRequest,
    {
      before: null,
      after: {
        title: cardPullRequest.title,
        body: 'Small change',
        head: 'feature',
        base: 'main',
        draft: true,
      },
    },
  ],
  [
    'github_update_pull_request',
    { ...cardPullRequest, isDraft: false },
    { before: { draft: true }, after: { draft: false } },
  ],
  [
    'github_submit_pull_request_review',
    {
      id: 'REVIEW',
      state: 'APPROVED',
      commitSha: 'a'.repeat(40),
      url: cardPullRequest.url + '#pullrequestreview-2',
    },
    { before: null, after: { event: 'APPROVE', body: '', commit_id: 'a'.repeat(40) } },
  ],
  ['github_create_pull_request_stack', stack, { before: null, after: [61, 62] }],
  [
    'github_add_pull_request_to_stack',
    {
      ...stack,
      pullRequests: connection([
        ...stack.pullRequests.nodes,
        {
          ...cardPullRequest,
          number: 63,
          title: 'Final dependent change',
          head: { ref: 'final', sha: 'd'.repeat(40) },
          base: { ref: 'dependent', sha: 'c'.repeat(40) },
        },
      ]),
    },
    { before: [61, 62], after: [61, 62, 63] },
  ],
]
export const cardEnvelope = (data) => ({
  host: 'github.com',
  untrusted: true,
  data,
  truncated: false,
  truncations: [],
})
export const cardWriteEnvelope = (resource, change) => ({
  host: 'github.com',
  untrusted: true,
  outcome: 'confirmed',
  resource,
  change,
})
export const cardBlock = (envelope, extra = {}) => ({
  kind: 'tool-result',
  call: { argsRaw: JSON.stringify({ owner: 'fixture-org', repo: 'demo', pullNumber: 61 }) },
  content: [{ type: 'text', text: JSON.stringify(envelope) }],
  ...extra,
})
