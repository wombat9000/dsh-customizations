import { githubSessionSeed } from './github-grants-fixture.mjs'
import { projectItemsBlock } from './project-items-fixture.js'
export const githubItemsWorkspace = 'github-items-workspace'
export const githubItemsPrompt = 'Review the synthetic historical project items.'
export function githubItemsSeed(cwd) {
  const fixture = githubSessionSeed(cwd)
  fixture.id = 'visual-test-github-items'
  const events = fixture.options.seed
  events.find((event) => event.type === 'user/message').data.content[0].text = githubItemsPrompt
  const call = events.find((event) => event.type === 'assistant/message').data.message.content[0]
  call.name = 'github_list_project_items'
  call.arguments = JSON.stringify({ owner: 'fixture-org', projectNumber: 7 })
  const attempt = events.find((event) => event.type === 'tool/call')
  attempt.data.name = call.name
  attempt.data.arguments = call.arguments
  events.find((event) => event.type === 'tool/result').data.message.content =
    projectItemsBlock().content
  // Additional historical snapshots reuse this disposable session. No tools run.
  const connection = (nodes) => ({
    nodes,
    totalCount: nodes.length,
    pageInfo: { hasNextPage: false, endCursor: null },
    nextCursor: null,
    truncated: false,
  })
  const issue = {
    id: 'ISSUE_SHELL_INTERNAL',
    number: 59,
    title: 'Compact issue shell fixture ' + 'long-title-'.repeat(12),
    state: 'OPEN',
    url: 'https://github.com/fixture-org/demo/issues/59',
    repository: { nameWithOwner: 'fixture-org/demo' },
  }
  const closed = {
    ...issue,
    id: 'ISSUE_SHELL_CLOSED',
    number: 60,
    title: 'Closed issue shell fixture',
    state: 'CLOSED',
    url: 'https://github.com/fixture-org/other/issues/60',
    repository: { nameWithOwner: 'fixture-org/other' },
  }
  const detail = {
    ...issue,
    body:
      'Visible description preview. ' +
      'Long description content. '.repeat(80) +
      'END OF SHELL DESCRIPTION <img src=x onerror=alert(1)>',
    parent: null,
    labels: connection([{ name: 'shell-label' }]),
    assignees: connection([{ login: 'fixture-user' }]),
    subIssues: connection([]),
    blockedBy: connection([closed]),
    blocking: connection([]),
  }
  const snapshots = [
    [
      'github_list_issues',
      connection([
        issue,
        {
          ...closed,
          repository: issue.repository,
          url: 'https://github.com/fixture-org/demo/issues/60',
        },
      ]),
    ],
    [
      'github_search_issues',
      { ...connection([issue, closed]), issueCount: 2, searchLimit: 1000, exhaustive: true },
    ],
    ['github_get_issue', detail],
  ]
  const end = events.pop()
  for (const [index, [name, data]] of snapshots.entries()) {
    const callId = `visual-github-issue-${index}`,
      step = index + 2,
      time = events[0].time
    const argumentsRaw = JSON.stringify({
      owner: 'fixture-org',
      ...(name === 'github_search_issues'
        ? { query: 'fixture' }
        : { repo: 'demo', ...(name === 'github_get_issue' ? { issueNumber: 59 } : {}) }),
    })
    events.push({
      seq: events.length,
      time,
      type: 'step/start',
      data: { turn: 1, step },
    })
    events.push({
      seq: events.length,
      time,
      type: 'assistant/message',
      surfaceOp: 'append',
      data: {
        turn: 1,
        step,
        stream: [],
        message: {
          id: `${callId}-assistant`,
          role: 'assistant',
          source: { kind: 'model', provider: 'synthetic-fixture', model: 'never-dispatched' },
          content: [{ type: 'tool-call', id: callId, name, arguments: argumentsRaw }],
        },
      },
    })
    events.push({
      seq: events.length,
      time,
      type: 'tool/call',
      data: { turn: 1, step, callId, name, arguments: argumentsRaw },
    })
    events.push({
      seq: events.length,
      time,
      type: 'tool/result',
      surfaceOp: 'append',
      data: {
        turn: 1,
        step,
        message: {
          id: `${callId}-result`,
          role: 'tool',
          source: { kind: 'tool', callId },
          toolCallId: callId,
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                host: 'github.com',
                untrusted: true,
                data,
                truncated: false,
                truncations: [],
              }),
            },
          ],
        },
      },
    })
    events.push({
      seq: events.length,
      time,
      type: 'step/end',
      data: { turn: 1, step },
    })
  }
  events.push({ ...end, seq: events.length })
  return fixture
}
