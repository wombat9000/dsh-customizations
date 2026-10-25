import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'
import { Projects, safeUrl } from '../../client/projects.tsx'
let root, container
const project = {
  id: 'p',
  name: 'Example',
  conventions: {},
  effectiveConventions: { workflow: 'Review' },
  conventionOrigins: { workflow: 'team' },
  teamName: 'Team',
  sources: [
    { id: 'repo', kind: 'github-repository', owner: 'owner', repo: 'repo' },
    { id: 'other', kind: 'linear-team', team: 'id' },
  ],
}
const catalog = {
  configuration: { teams: [], projects: [project] },
  projects: [project],
  providers: { github: true, linear: true },
  revision: 'r1',
}
const page = {
  projectId: 'p',
  sourceId: 'repo',
  issues: [
    {
      id: '1',
      title: '<img src=x>',
      identifier: '#1',
      source: 'github',
      kind: 'issue',
      status: 'OPEN',
      assignees: [],
      priority: 'High',
      boardFields: ['Status: Ready'],
      url: 'https://github.com.evil.test/x',
    },
  ],
  warnings: ['Nested results are incomplete'],
  hasNextPage: true,
  nextCursor: 'next',
  untrusted: true,
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
})
async function mount(request) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(React.createElement(Projects, { request })))
}
async function select(name, value) {
  const el = [...container.querySelectorAll('select')].find((el) =>
    el.parentElement.textContent.startsWith(name),
  )
  await act(async () => {
    el.value = value
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
async function click(text) {
  const el = [...container.querySelectorAll('button')].find((el) => el.textContent === text)
  await act(async () => el.click())
}

test('explicit selection, native fields, unsafe text and page continuation', async () => {
  const calls = []
  await mount(async (endpoint, input) => {
    calls.push([endpoint, input])
    return endpoint === 'catalog' ? catalog : page
  })
  expect(calls.map((call) => call[0])).toEqual(['catalog'])
  await select('Project ', 'p')
  expect(calls).toHaveLength(1)
  await select('Issue source ', 'repo')
  expect(container.textContent).toContain('Native statusOPEN')
  expect(container.textContent).toContain('AssigneeNot provided')
  expect(container.textContent).toContain('Status: Ready')
  expect(container.textContent).toContain('Nested results are incomplete')
  expect(container.querySelector('img,a')).toBeNull()
  expect(container.textContent).toContain('<img src=x>')
  await click('Next page')
  expect(calls.at(-1)[1].cursor).toBe('next')
})
test('source replacement aborts and ignores stale responses', async () => {
  let pending, oldSignal
  await mount(async (endpoint, input, signal) => {
    if (endpoint === 'catalog') return catalog
    if (input.sourceId === 'repo') {
      oldSignal = signal
      return new Promise((resolve) => {
        pending = resolve
      })
    }
    return { ...page, issues: [], warnings: ['Current source'], hasNextPage: false }
  })
  await select('Project ', 'p')
  await select('Issue source ', 'repo')
  await select('Issue source ', 'other')
  expect(oldSignal.aborted).toBe(true)
  await act(async () => pending(page))
  expect(container.textContent).toContain('Current source')
  expect(container.textContent).not.toContain('Nested results')
})
test('configuration saves only local settings with exact revision and retains rejected draft', async () => {
  const calls = []
  await mount(async (endpoint, input) => {
    calls.push([endpoint, input])
    if (endpoint === 'configure') throw new Error('Settings changed')
    return calls.length > 1 ? { ...catalog, revision: 'r2' } : catalog
  })
  await click('Configure projects')
  const draft = container.querySelector('textarea').value
  await click('Save local settings')
  expect(calls.at(-1)[0]).toBe('configure')
  expect(calls.at(-1)[1].expectedRevision).toBe('r1')
  expect(container.querySelector('textarea').value).toBe(draft)
  expect(container.querySelector('[role=alert]').textContent).toContain('Settings changed')
  expect(container.textContent).toContain('Saving never writes to GitHub or Linear')
  await click('Load current settings without discarding draft')
  expect(container.querySelector('textarea').value).toBe(draft)
  await click('I reconciled my draft; use this revision')
  await click('Save local settings')
  expect(calls.at(-1)[1].expectedRevision).toBe('r2')
})
test('pending local save disables closing and does not retry', async () => {
  let finish,
    saves = 0
  await mount(async (endpoint) => {
    if (endpoint === 'catalog') return catalog
    saves++
    return new Promise((resolve) => {
      finish = resolve
    })
  })
  await click('Configure projects')
  await click('Save local settings')
  const close = [...container.querySelectorAll('button')].find(
    (el) => el.textContent === 'Close configuration',
  )
  expect(close.disabled).toBe(true)
  expect(saves).toBe(1)
  await act(async () => finish(catalog))
  expect(container.textContent).toContain('Local settings saved')
})
test('account picker adds discovered sources to the draft without saving', async () => {
  const calls = []
  const discovered = {
    kind: 'github-repository',
    owner: 'octo',
    candidates: [
      {
        target: { kind: 'github-repository', owner: 'owner', repo: 'repo' },
        name: 'repo',
        suggestedId: 'repo',
      },
      {
        target: { kind: 'github-repository', owner: 'octo', repo: 'web' },
        name: 'web',
        suggestedId: 'web',
        description: '<b>Site</b>',
        inactive: true,
      },
    ],
    hasNextPage: true,
    nextCursor: 'more',
    untrusted: true,
  }
  await mount(async (endpoint, input) => {
    calls.push([endpoint, input])
    if (endpoint === 'catalog') return catalog
    if (endpoint === 'discover')
      return input.cursor
        ? {
            ...discovered,
            candidates: [
              {
                target: { kind: 'github-repository', owner: 'octo', repo: 'api' },
                name: 'api',
                suggestedId: 'api',
              },
            ],
            hasNextPage: false,
            nextCursor: undefined,
          }
        : discovered
    throw new Error(`unexpected ${endpoint}`)
  })
  await click('Configure projects')
  expect(calls.map((call) => call[0])).toEqual(['catalog'])
  await click('Find sources')
  expect(calls.at(-1)).toEqual(['discover', { kind: 'github-repository' }])
  expect(container.textContent).toContain('Owner: octo')
  expect(container.textContent).toContain('Already in: Example')
  expect(container.textContent).toContain('Closed or archived')
  expect(container.querySelector('b')).toBeNull()
  await click('Load more')
  expect(calls.at(-1)).toEqual(['discover', { kind: 'github-repository', cursor: 'more' }])
  const boxes = () => [...container.querySelectorAll('input[type=checkbox]')]
  expect(boxes()).toHaveLength(3)
  await act(async () => boxes()[1].click())
  await act(async () => boxes()[2].click())
  await select('Add as ', 'existing:p')
  await click('Add selected to draft')
  const draft = JSON.parse(container.querySelector('textarea').value)
  expect(draft.projects[0].sources.slice(2)).toEqual([
    { id: 'web', kind: 'github-repository', owner: 'octo', repo: 'web' },
    { id: 'api', kind: 'github-repository', owner: 'octo', repo: 'api' },
  ])
  expect(container.textContent).toContain('Added to the draft: 2')
  expect(calls.some((call) => call[0] === 'configure')).toBe(false)
  await act(async () => boxes()[0].click())
  await select('Add as ', 'separate')
  await click('Add selected to draft')
  const next = JSON.parse(container.querySelector('textarea').value)
  expect(next.projects.at(-1)).toEqual({
    id: 'repo',
    name: 'repo',
    conventions: {},
    sources: [{ id: 'repo', kind: 'github-repository', owner: 'owner', repo: 'repo' }],
  })
})
test('account picker keeps an invalid draft untouched and shows discovery errors', async () => {
  await mount(async (endpoint, input) => {
    if (endpoint === 'catalog') return catalog
    if (input.kind === 'linear-team') throw new Error('Linear is not loaded')
    return {
      kind: input.kind,
      candidates: [
        { target: { kind: 'linear-project', project: 'x' }, name: 'Plan', suggestedId: 'plan' },
      ],
      hasNextPage: false,
      untrusted: true,
    }
  })
  await click('Configure projects')
  await select('Source type ', 'linear-team')
  expect(container.querySelector('input:not([type])')).toBeNull()
  await click('Find sources')
  expect(container.querySelector('[role=alert]').textContent).toContain('Linear is not loaded')
  await select('Source type ', 'linear-project')
  await click('Find sources')
  const textarea = container.querySelector('textarea')
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(textarea, '{ broken')
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => container.querySelector('input[type=checkbox]').click())
  await click('Add selected to draft')
  expect(textarea.value).toBe('{ broken')
  expect(container.querySelector('[role=alert]').textContent).toContain('Fix the JSON draft')
})
test('empty and unavailable catalog remains actionable', async () => {
  await mount(async () => ({
    ...catalog,
    projects: [],
    providers: { github: false, linear: false },
  }))
  expect(container.textContent).toContain('No projects configured')
  expect(container.textContent).toContain('GitHub provider unavailable')
  expect(container.textContent).toContain('Linear provider unavailable')
  await click('Configure projects')
  expect(container.querySelector('textarea')).not.toBeNull()
})
test('source URLs allow only exact HTTPS tracker hosts without credentials', () => {
  for (const url of [
    'http://github.com/a',
    'https://a@github.com/a',
    'https://linear.app.evil.test/a',
    'javascript:alert(1)',
    'https://github.com:444/a',
  ])
    expect(safeUrl(url)).toBeUndefined()
  expect(safeUrl('https://linear.app/a')).toBe('https://linear.app/a')
  expect(safeUrl('https://github.com/a')).toBe('https://github.com/a')
})
