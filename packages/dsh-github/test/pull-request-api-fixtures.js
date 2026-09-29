import { connection } from './fixtures.js'

// Real API-shaped response bodies at the injected transport boundary. This
// fixture returns data only; the PR owner performs validation and mutations.
export const SHA = 'a'.repeat(40)
export const BASE = 'b'.repeat(40)
export const TOP = 'c'.repeat(40)
export const actor = { id: 'U_REVIEWER', login: 'reviewer' }
export const repository = {
  id: 'R_EXAMPLE',
  nameWithOwner: 'octocat/example',
  url: 'https://github.com/octocat/example',
  isArchived: false,
  isDisabled: false,
  viewerPermission: 'WRITE',
}
export const restRepository = {
  id: 42,
  node_id: 'R_EXAMPLE',
  full_name: 'octocat/example',
  url: 'https://api.github.com/repos/octocat/example',
  name: 'example',
}
export const target = { owner: 'octocat', repo: 'example', pullNumber: 7 }
export function restPull(number = 7, extra = {}) {
  return {
    id: 100 + number,
    node_id: `PR_${number}`,
    number,
    title: `PR ${number}`,
    body: 'Existing body',
    html_url: `https://github.com/octocat/example/pull/${number}`,
    state: 'open',
    draft: false,
    merged_at: null,
    head: {
      ref: number === 7 ? 'feature' : 'feature-top',
      sha: number === 7 ? SHA : TOP,
      repo: restRepository,
    },
    base: {
      ref: number === 7 ? 'main' : 'feature',
      sha: number === 7 ? BASE : SHA,
      repo: restRepository,
    },
    user: { id: 12, node_id: 'U_AUTHOR', login: 'author' },
    updated_at: '2026-04-15T10:00:00Z',
    mergeable: null,
    mergeable_state: 'unknown',
    changed_files: 1,
    ...extra,
  }
}
export function graphPull(number = 7, extra = {}) {
  return {
    id: `PR_${number}`,
    number,
    url: `https://github.com/octocat/example/pull/${number}`,
    title: `PR ${number}`,
    body: 'Existing body',
    updatedAt: '2026-04-15T10:00:00Z',
    state: 'OPEN',
    isDraft: false,
    viewerCanUpdate: true,
    viewerDidAuthor: false,
    headRefName: number === 7 ? 'feature' : 'feature-top',
    headRefOid: number === 7 ? SHA : TOP,
    baseRefName: number === 7 ? 'main' : 'feature',
    baseRefOid: number === 7 ? BASE : SHA,
    repository: { id: repository.id, nameWithOwner: repository.nameWithOwner },
    headRepository: { id: repository.id, nameWithOwner: repository.nameWithOwner },
    changedFiles: 1,
    author: { id: 'U_AUTHOR', login: 'author' },
    reviews: connection([]),
    ...extra,
  }
}
export function observed(number = 7, extra = {}, repoExtra = {}) {
  return {
    viewer: actor,
    repository: { ...repository, ...repoExtra, pullRequest: graphPull(number, extra) },
  }
}
export function createObserved(extra = {}) {
  return {
    viewer: actor,
    repository: {
      ...repository,
      head: {
        id: 'REF_FEATURE',
        name: 'feature',
        prefix: 'refs/heads/',
        target: { __typename: 'Commit', oid: SHA },
      },
      base: {
        id: 'REF_MAIN',
        name: 'main',
        prefix: 'refs/heads/',
        target: { __typename: 'Commit', oid: BASE },
      },
      pullRequests: connection([]),
      ...extra,
    },
  }
}
export const file = {
  sha: 'd'.repeat(40),
  filename: 'src/app.js',
  status: 'modified',
  additions: 1,
  deletions: 1,
  changes: 2,
  patch: '@@ -1,3 +1,3 @@\n context\n-old\n+new\n last',
}
export function review(extra = {}) {
  return {
    id: 80,
    node_id: 'REVIEW_80',
    state: 'COMMENTED',
    body: 'Please clarify.',
    commit_id: SHA,
    html_url: 'https://github.com/octocat/example/pull/7#pullrequestreview-80',
    pull_request_url: 'https://api.github.com/repos/octocat/example/pulls/7',
    submitted_at: '2026-04-15T11:00:00Z',
    user: { node_id: actor.id, login: actor.login },
    ...extra,
  }
}
export function stack(numbers = [7, 8], extra = {}) {
  return {
    id: 9876543,
    number: 42,
    node_id: 'STACK_42',
    url: 'https://api.github.com/repos/octocat/example/stacks/42',
    base: { ref: 'main' },
    open: true,
    created_at: '2026-04-15T10:00:00Z',
    pull_requests: numbers.map((number) => {
      const pr = restPull(number)
      // The official stack response omits body/updated_at and supplies minimal repos.
      return {
        id: pr.id,
        node_id: pr.node_id,
        number,
        title: pr.title,
        state: pr.state,
        draft: pr.draft,
        merged_at: null,
        html_url: pr.html_url,
        head: {
          ref: pr.head.ref,
          sha: pr.head.sha,
          repo: { id: 42, name: 'example', url: restRepository.url },
        },
        base: {
          ref: pr.base.ref,
          sha: pr.base.sha,
          repo: { id: 42, name: 'example', url: restRepository.url },
        },
      }
    }),
    ...extra,
  }
}
export const createArgs = {
  owner: 'octocat',
  repo: 'example',
  title: 'New PR',
  body: 'Exact\nbody',
  head: 'feature',
  base: 'main',
}
