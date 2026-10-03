import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { ApprovalPreview, NativeApprovalDetail } from '../../client/approval-components.tsx'
import { approvalModel } from '../../client/approval-model.ts'
import {
  approvalNames,
  approvalValue,
  approvalReason,
  approvalTool,
  issueBody,
} from '../approval-preview-fixtures.js'
const h = React.createElement
let root, container
globalThis.IS_REACT_ACT_ENVIRONMENT = true
afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
})
async function mount(operation, reason = approvalReason(approvalValue(operation))) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const model = approvalModel(approvalTool(operation), reason)
  // RC2 native structure, controls represented only for isolation assertions.
  await act(async () =>
    root.render(
      h(
        'div',
        null,
        h(
          'div',
          { 'data-approval-scroll': '' },
          h('div', { 'data-native-reason': '' }, reason),
          h('div', null, h(ApprovalPreview, { model })),
        ),
        h('button', null, 'Native reject'),
        h('button', null, 'Native allow'),
      ),
    ),
  )
  return reason
}
test.each(approvalNames)(
  '%s provides native-detail readable preview, exact payload and no duplicate buttons',
  async (operation) => {
    const reason = await mount(operation)
    expect(container.querySelector('.gh-approval-valid')).not.toBeNull()
    expect(getComputedStyle(container.querySelector('[data-native-reason]')).display).toBe('none')
    expect(container.querySelectorAll('button')).toHaveLength(2)
    expect(container.querySelector('.gh-approval-valid > details').open).toBe(false)
    const summary = page.getByText('Technical details — complete exact approval payload', {
      exact: true,
    })
    await act(async () => summary.click())
    expect(container.querySelector('.gh-approval-valid > details pre').textContent).toBe(reason)
  },
)
test('long safe Markdown remains fully reviewable with source, keyboard expansion and narrow layout', async () => {
  await mount('createIssue')
  const region = container.querySelector('.gh-approval-valid')
  region.style.width = '320px'
  expect(region.scrollWidth).toBeLessThanOrEqual(region.clientWidth + 1)
  expect(region.querySelectorAll('script,img,iframe')).toHaveLength(0)
  expect(
    Array.from(region.querySelectorAll('a')).every((a) => a.href.startsWith('https://github.com/')),
  ).toBe(true)
  expect(region.querySelector('.gh-approval-markdown strong').textContent).toBe('Important')
  expect(region.querySelector('.gh-approval-markdown').textContent).toContain('<img')
  expect(
    region.querySelector('pre[aria-label="Proposed issue body: JSON string"]').textContent,
  ).toBe(JSON.stringify(issueBody))
  expect(region.querySelector('.gh-approval-markdown').textContent).toContain(
    'END OF COMPLETE BODY',
  )
  const summary = Array.from(region.querySelectorAll('summary')).find(
    (x) => x.textContent === 'Proposed issue body: exact source and whitespace',
  )
  summary.focus()
  expect(document.activeElement).toBe(summary)
  await act(async () => {
    await userEvent.keyboard('{Enter}')
  })
  expect(summary.parentElement.open).toBe(true)
  expect(summary.parentElement.querySelector('pre').textContent).toBe(issueBody)
})
test('draft PR preview labels branch direction and preserves the complete body and payload', async () => {
  const reason = await mount('createPullRequest')
  const region = container.querySelector('.gh-approval-valid')
  region.style.width = '320px'
  expect(region.scrollWidth).toBeLessThanOrEqual(region.clientWidth + 1)
  expect(region.querySelector('h3').textContent).toBe('Create draft pull request')
  const resources = [...region.querySelectorAll('.gh-approval-resource')]
  expect(resources.map((node) => node.querySelector('small').textContent)).toEqual([
    'Destination repository',
    'State',
    'Head branch (source)',
    'Base branch (destination)',
  ])
  expect(resources[0].querySelector('a').href).toBe('https://github.com/fixture/repo')
  expect(resources[1].querySelector('span').textContent).toBe('Draft')
  expect(resources[2].querySelector('code').textContent).toBe('feature')
  expect(resources[3].querySelector('code').textContent).toBe('main')
  expect(region.textContent).toContain('No branch pushes or merge')
  expect(region.querySelector('.gh-approval-markdown strong').textContent).toBe('Important')
  expect(region.querySelector('.gh-approval-markdown').textContent).toContain(
    'END OF COMPLETE BODY',
  )
  expect(region.querySelectorAll('script,img,iframe')).toHaveLength(0)
  await act(async () =>
    page.getByText('Proposed PR body: exact source and whitespace', { exact: true }).click(),
  )
  expect(region.querySelector('pre[aria-label="Proposed PR body: JSON string"]').textContent).toBe(
    JSON.stringify(issueBody),
  )
  await act(async () =>
    page.getByText('Technical details — complete exact approval payload', { exact: true }).click(),
  )
  expect(region.querySelector(':scope > details pre').textContent).toBe(reason)
})
const prVariants = [
  'updatePullRequest',
  'updatePullRequest:title-only',
  'updatePullRequest:body-empty',
  'updatePullRequest:draft',
  'updatePullRequest:ready',
  'submitPullRequestReview',
  'submitPullRequestReview:approve',
  'submitPullRequestReview:request-changes',
  'submitPullRequestReview:inline',
  'submitPullRequestReview:multiline',
  'createPullRequestStack',
  'addPullRequestToStack',
]
test.each(prVariants)(
  '%s presents the bound PR change with closed technical details and safe narrow content',
  async (request) => {
    const value = approvalValue(request)
    const reason = await mount(request, approvalReason(value))
    const region = container.querySelector('.gh-approval-valid')
    expect(region).not.toBeNull()
    region.style.width = '320px'
    expect(region.scrollWidth).toBeLessThanOrEqual(region.clientWidth + 1)
    expect(region.querySelector(':scope > details').open).toBe(false)
    const main = region.querySelector('.gh-approval-main')
    expect(main.textContent).toContain('Destination repository')
    expect(main.querySelectorAll('script,img,iframe')).toHaveLength(0)
    expect(
      [...main.querySelectorAll('a')].every((a) =>
        a.href.startsWith('https://github.com/fixture/repo'),
      ),
    ).toBe(true)
    const exact = []
    if (value.operation === 'updatePullRequest') {
      expect(main.textContent).toContain('Pull request')
      if ('draft' in value.change.after) {
        expect(main.textContent).toContain('State before')
        expect(main.textContent).toContain('State after')
        const sections = [...main.querySelectorAll('section')]
        for (const [label, state] of [
          ['State before', value.change.before.draft],
          ['State after', value.change.after.draft],
        ]) {
          const row = sections.find((node) => node.querySelector('h4')?.textContent === label)
          expect(row?.textContent).toContain(state ? 'Draft' : 'Ready for review')
        }
      } else {
        for (const key of Object.keys(value.exactPayload)) {
          const suffix = key === 'title' ? 'PR title' : 'PR body'
          exact.push(
            [`Current ${suffix}`, value.change.before[key]],
            [`Proposed ${suffix}`, value.exactPayload[key]],
          )
        }
        if ('body' in value.exactPayload && value.exactPayload.body !== '') {
          expect(main.querySelector('.gh-approval-markdown strong')?.textContent).toBe('Important')
          expect(main.textContent).toContain('END OF COMPLETE BODY')
        }
      }
    } else if (value.operation === 'submitPullRequestReview') {
      expect(main.textContent).toContain('Pull request')
      expect(main.textContent).toContain('Review action')
      expect(main.textContent).toContain(
        { COMMENT: 'Comment', APPROVE: 'Approve', REQUEST_CHANGES: 'Request changes' }[
          value.exactPayload.event
        ],
      )
      expect(main.textContent).toContain('Head commit')
      expect(main.textContent).toContain(value.exactPayload.commit_id)
      exact.push(['Review body', value.exactPayload.body])
      if (value.exactPayload.comments) {
        expect(main.textContent).toContain('Inline review comments')
        const comment = value.exactPayload.comments[0]
        expect(main.textContent).toContain(comment.path)
        expect(main.textContent).toContain(comment.side)
        expect(main.textContent).toContain(String(comment.line))
        if (comment.start_line) expect(main.textContent).toContain(String(comment.start_line))
        expect(
          [...main.querySelectorAll('pre[aria-label$="JSON string"]')].some(
            (pre) => pre.textContent === JSON.stringify(comment.body),
          ),
        ).toBe(true)
      }
    } else {
      expect(main.textContent).toContain(
        value.operation === 'createPullRequestStack'
          ? 'Proposed stack order (bottom to top)'
          : 'Before stack order',
      )
      if (value.operation === 'addPullRequestToStack')
        expect(main.textContent).toContain('After stack order')
      let previous = -1
      for (const pr of value.targets.pullRequests) {
        const position = main.textContent.indexOf(pr.title)
        expect(position).toBeGreaterThan(previous)
        previous = position
        for (const identity of [
          `#${pr.number}`,
          pr.head.ref,
          pr.head.sha,
          pr.base.ref,
          pr.base.sha,
        ])
          expect(main.textContent).toContain(identity)
      }
      expect(main.textContent).toMatch(/No branch base changes|no branch base changes/)
      expect(main.textContent).toMatch(/merge/i)
    }
    for (const [label, source] of exact) {
      const summary = [...region.querySelectorAll('summary')].find(
        (node) => node.textContent === `${label}: exact source and whitespace`,
      )
      expect(summary, label).toBeDefined()
      expect(summary.parentElement.open).toBe(false)
      summary.focus()
      await act(async () => userEvent.keyboard('{Enter}'))
      expect(summary.parentElement.open).toBe(true)
      expect(summary.parentElement.querySelector('pre').textContent).toBe(source)
      expect(
        summary.parentElement.querySelector('pre[aria-label$="JSON string"]').textContent,
      ).toBe(JSON.stringify(source))
    }
    const technical = region.querySelector(':scope > details > summary')
    technical.focus()
    await act(async () => userEvent.keyboard('{Enter}'))
    expect(region.querySelector(':scope > details pre').textContent).toBe(reason)
    expect(container.querySelectorAll('button')).toHaveLength(2)
  },
)
test.each([
  'updatePullRequest',
  'submitPullRequestReview',
  'createPullRequestStack',
  'addPullRequestToStack',
])('%s malformed or future payload preserves raw native details', async (operation) => {
  const value = approvalValue(operation)
  value.exactPayload.future = 'unknown mutation semantics'
  const reason = await mount(operation, approvalReason(value))
  expect(container.querySelector('.gh-approval-valid')).toBeNull()
  expect(getComputedStyle(container.querySelector('[data-native-reason]')).display).not.toBe('none')
  expect(container.querySelector('[data-native-reason]').textContent).toBe(reason)
  expect(container.querySelectorAll('button')).toHaveLength(2)
})
test.each(['', '*\n`\n**\n  \t\n[bad](https://github.com.evil.test/a)'])(
  'empty and literal Markdown body stays reviewable (%j)',
  async (body) => {
    const value = approvalValue()
    value.targets.repository = { id: 'R' }
    value.change.body = value.exactPayload.body = body
    await mount('createIssue', approvalReason(value))
    expect(container.textContent).toContain('Name unavailable')
    expect(container.querySelectorAll('em:empty,code:empty,a[href*="evil.test"]')).toHaveLength(0)
    if (body === '') expect(container.textContent).toContain('Empty string')
    await act(async () =>
      page.getByText('Proposed issue body: exact source and whitespace', { exact: true }).click(),
    )
    expect(
      [...container.querySelectorAll('details[open] pre')].some((pre) => pre.textContent === body),
    ).toBe(true)
  },
)
test.each([false, true])(
  'template copy renders both source and behavior for draft option %s',
  async (includeDraftIssues) => {
    const value = approvalValue('createProject')
    value.mutation = 'copyProject'
    value.targets.template = { id: 'TEMPLATE', title: 'Source board' }
    value.exactPayload.projectId = 'TEMPLATE'
    value.exactPayload.includeDraftIssues = includeDraftIssues
    value.change.copyBehavior = {
      sourceTemplate: 'TEMPLATE',
      includeDraftIssues,
      ordinaryNewProject: true,
      copied: 'Project fields.',
      notCopied: 'Ordinary issues; visibility is private.',
    }
    await mount('createProject', approvalReason(value))
    expect(container.querySelector('.gh-approval-main').textContent).toContain('Source template')
    expect(container.querySelector('.gh-approval-main').textContent).toContain(
      `Copy draft issues${includeDraftIssues}`,
    )
    expect(container.querySelector('.gh-approval-main').textContent).toContain(
      'Not copied / visibility',
    )
  },
)
test('dependency direction distinguishes repositories with identical issue titles and numbers', async () => {
  const value = approvalValue('addIssueDependency')
  value.targets.blockedIssue.repository = { nameWithOwner: 'one/repo' }
  value.targets.blockingIssue.repository = { nameWithOwner: 'two/repo' }
  value.targets.blockingIssue.number = value.targets.blockedIssue.number
  value.targets.blockingIssue.title = value.targets.blockedIssue.title
  await mount('addIssueDependency', approvalReason(value))
  expect(
    [...container.querySelectorAll('.gh-approval-resource')].map((node) =>
      [...node.querySelectorAll('small')].map((small) => small.textContent),
    ),
  ).toEqual([
    ['Blocked issue', 'one/repo · #49'],
    ['Blocking issue', 'two/repo · #49'],
  ])
})
test('malformed model leaves native full reason visible with controls', async () => {
  await mount('createIssue', 'Complete malformed approval details')
  expect(container.querySelector('.gh-approval-valid')).toBeNull()
  expect(getComputedStyle(container.querySelector('[data-native-reason]')).display).not.toBe('none')
  expect(container.textContent).toContain('Complete malformed approval details')
  expect(container.querySelectorAll('button')).toHaveLength(2)
})
test('native single-seat component correlates session and call, and retains RC2 raw command fallback', async () => {
  await mount('createIssue')
  const pending = new Map([
    [
      'other-session',
      {
        kind: 'approval',
        callId: 'call',
        toolName: 'github_create_issue',
        reason: approvalReason(approvalValue()),
      },
    ],
  ])
  const nodes = new Map([
    [
      'node',
      {
        kind: 'tool-call',
        data: {
          root: { callId: 'call', argsRaw: JSON.stringify({ command: 'printf "not executed"' }) },
        },
      },
    ],
  ])
  await act(async () =>
    root.render(
      h(NativeApprovalDetail, {
        sessionId: 'session',
        callId: 'call',
        useSessionStatus: (select) =>
          select(
            new Map([...pending].map(([id, pendingInteraction]) => [id, { pendingInteraction }])),
          ),
        useChat: (select) => select({ nodes }),
      }),
    ),
  )
  expect(container.textContent).toBe('printf "not executed"')
  expect(container.querySelector('.gh-approval-valid')).toBeNull()
  nodes.get('node').data.root.kind = 'tool-result'
  await act(async () =>
    root.render(
      h(NativeApprovalDetail, {
        sessionId: 'session',
        callId: 'call',
        useSessionStatus: (select) =>
          select(
            new Map([...pending].map(([id, pendingInteraction]) => [id, { pendingInteraction }])),
          ),
        useChat: (select) => select({ nodes }),
      }),
    ),
  )
  expect(container.textContent).toBe('')
})
test('membership resource cards distinguish roles with keyboard links in narrow layout', async () => {
  await mount('addProjectItem')
  const region = container.querySelector('.gh-approval-valid')
  region.style.width = '320px'
  expect(region.scrollWidth).toBeLessThanOrEqual(region.clientWidth + 1)
  const resources = [...region.querySelectorAll('.gh-approval-resource')]
  expect(resources.map((node) => node.querySelector('small').textContent)).toEqual([
    'Destination project',
    'Issue to add',
  ])
  expect(region.querySelectorAll('summary')).toHaveLength(1)
  expect(region.textContent).not.toContain('Use the native approval buttons below.')
  await act(async () => userEvent.keyboard('{Tab}'))
  for (const resource of resources) {
    const link = resource.querySelector('a')
    expect(link).not.toBeNull()
    expect(link.textContent).toContain('↗')
    link.focus()
    expect(document.activeElement).toBe(link)
    expect(getComputedStyle(link).outlineStyle).not.toBe('none')
  }
  const summary = region.querySelector('summary')
  summary.focus()
  await act(async () => userEvent.keyboard('{Enter}'))
  expect(summary.parentElement.open).toBe(true)
})
test('long and missing resource metadata remains bounded without invented names', async () => {
  const value = approvalValue('addProjectItem')
  value.targets.project.title = 'Project'.repeat(200)
  value.targets.project.owner = { login: 'owner'.repeat(100) }
  value.targets.issue.title = 'Issue'.repeat(200)
  value.targets.issue.repository = { nameWithOwner: 'repo'.repeat(100) }
  await mount('addProjectItem', approvalReason(value))
  const region = container.querySelector('.gh-approval-valid')
  region.style.width = '320px'
  expect(region.scrollWidth).toBeLessThanOrEqual(region.clientWidth + 1)
  expect(region.querySelectorAll('.gh-approval-resource small')).toHaveLength(4)
  await act(async () => root.unmount())
  container.remove()
  delete value.targets.project.title
  delete value.targets.project.owner
  delete value.targets.project.number
  delete value.targets.project.url
  await mount('addProjectItem', approvalReason(value))
  expect(container.querySelector('.gh-approval-resource').textContent).toContain('Name unavailable')
  expect(container.querySelector('.gh-approval-resource').querySelector('a')).toBeNull()
})
test('adding an issue excludes unrelated project README from primary area', async () => {
  await mount('addProjectItem')
  expect(container.querySelector('.gh-approval-main').textContent).not.toContain(
    'UNRELATED PROJECT README SENTINEL',
  )
  expect(container.querySelector('.gh-approval-valid > details').textContent).toContain(
    'UNRELATED PROJECT README SENTINEL',
  )
})
