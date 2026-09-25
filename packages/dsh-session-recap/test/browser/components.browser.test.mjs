import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { page } from 'vitest/browser'
import { RecapActionButton } from '../../client/components/RecapActionButton.tsx'
import { RecapPanel, RecapBulletList } from '../../client/components/RecapPanel.tsx'
import {
  SelectionDetails,
  SelectionDetailsView,
  SelectionTable,
} from '../../client/components/SelectionDetails.tsx'
import { SettingsForm } from '../../client/components/SettingsForm.tsx'
import { RecapAction, RecapCard } from '../../client/containers/recap.tsx'
import { SettingsCard } from '../../client/containers/SettingsCard.tsx'

// Direct source-component tests complement, rather than replace, bundle slot tests.
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const h = React.createElement
let root, container
async function render(Component, props) {
  if (!root) {
    container = document.createElement('main')
    document.body.append(container)
    root = createRoot(container)
  }
  await act(async () => root.render(h(Component, props)))
}
const click = (locator) => act(async () => locator.click())
afterEach(async () => {
  if (root) await act(async () => root.unmount())
  container?.remove()
  root = container = undefined
  vi.restoreAllMocks()
})

const diagnostics = () => ({
  version: 1,
  model: '<img src=x onerror=alert(1)>',
  questionSetVersion: 'v1',
  status: 'complete',
  thresholds: { support: 0.6, usefulness: 1.5, confidence: 0.3, maxCards: 3 },
  categories: [
    {
      label: 'direction',
      support: 0.912345,
      usefulness: 2.4567,
      confidence: 0.7,
      selected: true,
      reasons: [],
    },
    {
      label: '<script>bad()</script>',
      support: null,
      usefulness: null,
      confidence: null,
      selected: false,
      reasons: ['support', 'unknown'],
    },
  ],
})

test('action button props control labels, loading, unread, open and error without disabling callbacks', async () => {
  const onClick = vi.fn()
  const button = () => container.querySelector('button')
  for (const [state, label] of [
    [{}, 'Generate recap'],
    [{ recap: {}, unread: true }, 'Show recap'],
    [{ recap: {}, open: true }, 'Hide recap'],
    [{ error: '<b>failure</b>' }, 'Retry recap'],
    [{ busy: true, error: 'failure', unread: true }, 'Open recap when ready'],
  ]) {
    await render(RecapActionButton, { ...state, onClick })
    expect(button().getAttribute('aria-label')).toBe(label)
    expect(button().dataset.busy).toBe(String(!!state.busy))
    expect(button().dataset.unread).toBe(String(!!state.unread))
    expect(button().getAttribute('aria-expanded')).toBe(String(!!state.open))
    expect(button().title).toBe(
      state.busy ? 'Generating recap…' : state.error ? `Retry recap: ${state.error}` : label,
    )
    expect(button().disabled).toBe(false)
    await click(page.getByRole('button', { name: label, exact: true }))
  }
  expect(onClick).toHaveBeenCalledTimes(5)
  expect(container.querySelector('b')).toBeNull()
  expect(container.querySelector('svg').getAttribute('aria-hidden')).toBe('true')
})

test('panel renders escaped bullets, headline, errors, loading and only known fallback captions', async () => {
  const recap = { headline: '<img src=x>', bullets: ['<script>bad()</script>', 7, 'Second'] }
  await render(RecapPanel, {
    busy: true,
    error: '<b>failure</b>',
    recap,
    selection: { mode: 'standard', reason: 'unavailable' },
  })
  expect(container.querySelectorAll('li')).toHaveLength(2)
  expect(container.querySelector('h2').textContent).toBe(recap.headline)
  expect(container.querySelector('h2').title).toBe(recap.headline)
  expect(container.querySelector('[role="alert"]').textContent).toBe('<b>failure</b>')
  expect(container.querySelectorAll('[role="status"]')).toHaveLength(1)
  expect(container.textContent).toContain('Generating recap…')
  expect(container.textContent).toContain('Jev unavailable')
  expect(container.querySelector('img, script, b')).toBeNull()
  for (const [selection, caption] of [
    [{ mode: 'standard', reason: 'no-labels' }, 'No suitable categories'],
    [{ mode: 'standard', reason: '<b>unknown</b>' }, null],
    [{ mode: 'cards', reason: 'unavailable' }, null],
  ]) {
    await render(RecapPanel, { recap, selection })
    expect(container.querySelector('.dsh-session-recap-card__caption')?.textContent ?? null).toBe(
      caption,
    )
  }
  await render(RecapBulletList, { bullets: null })
  expect(container.querySelector('ul').children).toHaveLength(0)
})

test('panel filters visual cards, fixes titles and icons, clips text and hides bullet fallback', async () => {
  await render(RecapPanel, {
    recap: {
      bullets: ['Hidden fallback'],
      cards: [
        { label: 'alien', text: 'Unknown' },
        { label: 'direction', text: '<img>'.repeat(50) },
        { label: 'direction', text: 'Duplicate' },
        { label: 'decision', text: 'Decision body' },
        { label: 'insight', text: 'Insight body' },
        { label: 'paused', text: 'Fourth' },
      ],
    },
  })
  expect([...container.querySelectorAll('li')].map((node) => node.dataset.recapCard)).toEqual([
    'direction',
    'decision',
    'insight',
  ])
  expect(container.querySelector('h3').textContent).toBe('Direction')
  expect(container.querySelector('.dsh-session-recap-card__text').textContent).toHaveLength(180)
  expect(container.querySelectorAll('svg path')).toHaveLength(3)
  expect(container.querySelector('img')).toBeNull()
  expect(container.textContent).not.toContain('Hidden fallback')
})

test('all six card labels use fixed icons and titles; invalid-only cards fall back to bullets', async () => {
  const titles = {
    direction: 'Direction',
    decision: 'Decision',
    insight: 'Key insight',
    question: 'Open question',
    next_step: 'Next step',
    paused: 'Where we paused',
  }
  for (const [label, title] of Object.entries(titles)) {
    await render(RecapPanel, {
      recap: {
        cards: [
          {
            label,
            text: 'Body',
            title: 'MODEL TITLE',
            style: { color: 'red' },
            path: 'MODEL PATH',
            accent: 'red',
          },
        ],
      },
    })
    expect(container.querySelector('h3').textContent).toBe(title)
    expect(container.querySelector('svg path').getAttribute('d')).not.toBe('MODEL PATH')
    expect(container.querySelector('svg').style.getPropertyValue('--recap-accent')).not.toBe('red')
    expect(container.querySelector('li').getAttribute('style')).toBeNull()
  }
  await render(RecapPanel, {
    recap: {
      cards: [
        { label: '__proto__', text: 'Prototype' },
        { label: 'alien', text: 'Unknown' },
        { label: 'direction', text: ' ' },
        { label: 'decision', text: 42 },
        null,
      ],
      bullets: ['Fallback'],
    },
  })
  expect(container.querySelectorAll('li')).toHaveLength(1)
  expect(container.querySelector('li').textContent).toBe('Fallback')
  expect(container.querySelector('svg')).toBeNull()
})

test('selection table rounds scores and escapes unknown labels with unchanged reason wording', async () => {
  await render(SelectionTable, diagnostics())
  expect(container.textContent).toContain('0.912')
  expect(container.textContent).toContain('2.457')
  expect(container.textContent).toContain('Selected')
  expect(container.textContent).toContain('Not selected: support below 0.6; not evaluated')
  expect(container.textContent).toContain('—')
  expect(container.querySelector('script')).toBeNull()
})

test('selection view invokes supplied copy callback and shows supplied status', async () => {
  const onCopy = vi.fn()
  await render(SelectionDetailsView, {
    diagnostics: diagnostics(),
    json: '<script>json</script>',
    copyStatus: 'Supplied status',
    onCopy,
  })
  await click(page.getByText('Selection details', { exact: true }))
  await click(page.getByRole('button', { name: 'Copy diagnostics JSON' }))
  expect(onCopy).toHaveBeenCalledOnce()
  expect(container.querySelector('[role="status"]').textContent).toBe('Supplied status')
  expect(container.querySelector('pre').textContent).toBe('<script>json</script>')
  expect(container.querySelector('script, img')).toBeNull()
})

test('selection details copies only its snapshot, reports failure safely and resets status on new diagnostics', async () => {
  const snapshot = diagnostics()
  const copied = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
  await render(SelectionDetails, { diagnostics: snapshot, recap: 'PRIVATE RECAP' })
  await click(page.getByText('Selection details', { exact: true }))
  await click(page.getByRole('button', { name: 'Copy diagnostics JSON' }))
  expect(copied).toHaveBeenCalledWith(JSON.stringify(snapshot, null, 2))
  expect(container.textContent).toContain('Diagnostics copied.')
  expect(copied.mock.calls[0][0]).not.toContain('PRIVATE RECAP')
  await render(SelectionDetails, { diagnostics: { ...snapshot, status: 'unavailable' } })
  expect(container.querySelector('[role="status"]')).toBeNull()
  expect(container.textContent).toContain(
    'Jev evaluation was unavailable; no category scores were retained.',
  )
  copied.mockRejectedValue(Error('PRIVATE ERROR'))
  await click(page.getByRole('button', { name: 'Copy diagnostics JSON' }))
  expect(container.textContent).toContain(
    'Clipboard unavailable. Expand the JSON and copy it manually.',
  )
  expect(container.textContent).not.toContain('PRIVATE ERROR')
  await render(SelectionDetails, { diagnostics: { version: 2 } })
  expect(container.children).toHaveLength(0)
})

const draft = {
  autoRecap: false,
  useJev: false,
  inactivityMinutes: 30,
  provider: 'route',
  model: 'model',
}
test('settings form is prop driven and delivers control callbacks without RPC', async () => {
  const onToggle = vi.fn(),
    onChange = vi.fn(),
    onChooseModel = vi.fn(),
    onSave = vi.fn()
  const props = {
    open: true,
    draft,
    providers: [{ id: 'p', name: '<provider>', models: [{ id: 'm', name: '<model>' }] }],
    onToggle,
    onChange,
    onChooseModel,
    onSave,
  }
  await render(SettingsForm, props)
  await click(page.getByRole('checkbox', { name: 'Automatic recap on return' }))
  expect(onChange).toHaveBeenLastCalledWith('autoRecap', true)
  await click(page.getByRole('checkbox', { name: 'Use Jev to choose recap cards' }))
  expect(onChange).toHaveBeenLastCalledWith('useJev', true)
  await act(async () => page.getByLabelText('Inactivity (minutes)').fill('12'))
  expect(onChange).toHaveBeenLastCalledWith('inactivityMinutes', '12')
  await act(async () => page.getByLabelText('Provider ID').fill('new-provider'))
  expect(onChange).toHaveBeenLastCalledWith('provider', 'new-provider')
  await act(async () => page.getByLabelText('Model ID').fill('new-model'))
  expect(onChange).toHaveBeenLastCalledWith('model', 'new-model')
  await act(async () => page.getByRole('combobox').selectOptions(JSON.stringify(['p', 'm'])))
  expect(onChooseModel).toHaveBeenCalledOnce()
  await click(page.getByRole('button', { name: 'Save', exact: true }))
  expect(onSave).toHaveBeenCalledOnce()
  await click(page.getByRole('button', { name: 'Collapse: Session recap' }))
  expect(onToggle).toHaveBeenCalledOnce()
  expect(container.querySelector('provider, model')).toBeNull()
  await render(SettingsForm, { ...props, busy: true, error: '<img>error', notice: '<b>notice' })
  expect([...container.querySelectorAll('input, select')].every((input) => input.disabled)).toBe(
    true,
  )
  expect(page.getByRole('button', { name: 'Saving…' }).element().disabled).toBe(true)
  expect(container.querySelector('[role="alert"]').textContent).toBe('<img>error')
  expect(container.querySelector('[role="status"]').textContent).toBe('<b>notice')
  expect(container.querySelector('img, b')).toBeNull()
  await render(SettingsForm, { ...props, draft: null })
  expect(container.textContent).toContain('Loading settings…')
  await render(SettingsForm, { ...props, providers: [] })
  expect(container.querySelector('select').disabled).toBe(true)
  await render(SettingsForm, { ...props, open: false })
  expect(container.querySelector('input')).toBeNull()
})

function sessionProps(state = {}) {
  const session = { blank: false, openState: 'open', running: false }
  const chat = {
    timeline: { turnOrder: [1], turns: new Map([[1, { status: 'closed' }]]) },
    locations: { getTurn: () => ['tail'] },
    nodes: new Map([
      [
        'tail',
        {
          kind: 'turn-tail',
          data: { closing: { status: 'settled', finalNode: { messageId: 'closing' } } },
        },
      ],
    ]),
  }
  const cleanup = vi.fn()
  const unsubscribe = vi.fn()
  const controller = {
    getSnapshot: () => state,
    subscribe: vi.fn(() => unsubscribe),
    click: vi.fn(),
    observeSession: vi.fn(),
    mount: vi.fn(() => cleanup),
  }
  return {
    session,
    chat,
    cleanup,
    unsubscribe,
    props: {
      sessionId: 'session',
      messageId: 'closing',
      controller,
      useSession: (select) => select(session),
      useChat: (select) => select(chat),
      useConversation: (select) => select({ activeTargets: new Set(['chat']) }),
    },
  }
}

test('source action container guards blank, unavailable and non-closing seats and disposes styles', async () => {
  const { session, chat, props, unsubscribe } = sessionProps()
  const style = 'style[data-plugin-css="wombat9000-session-recap/recap"]'
  for (const blank of [true, undefined]) {
    session.blank = blank
    await render(RecapAction, props)
    expect(container.children).toHaveLength(0)
    expect(document.querySelector(style)).toBeNull()
  }
  session.blank = false
  await render(RecapAction, { ...props, messageId: 'historical' })
  expect(container.children).toHaveLength(0)
  chat.timeline.turns.get(1).status = 'running'
  await render(RecapAction, props)
  expect(container.children).toHaveLength(0)
  chat.timeline.turns.get(1).status = 'closed'
  const closing = chat.nodes.get('tail').data.closing
  closing.status = 'pending'
  await render(RecapAction, props)
  expect(container.children).toHaveLength(0)
  closing.status = 'settled'
  await render(RecapAction, props)
  expect(document.querySelector(style)).not.toBeNull()
  await click(page.getByRole('button', { name: 'Generate recap' }))
  expect(props.controller.click).toHaveBeenCalledWith('session')
  expect(props.controller.mount).not.toHaveBeenCalled()
  expect(props.controller.subscribe).toHaveBeenCalledWith('session', expect.any(Function))
  await render(RecapAction, { ...props, sessionId: 'second-session' })
  expect(unsubscribe).toHaveBeenCalledOnce()
  expect(props.controller.subscribe).toHaveBeenLastCalledWith(
    'second-session',
    expect.any(Function),
  )
  await render(() => null)
  expect(unsubscribe).toHaveBeenCalledTimes(2)
  expect(document.querySelector(style)).toBeNull()
})

test('source dock observes and mounts while hidden, gates visibility, and cleans up', async () => {
  const state = { open: true }
  const { session, props, cleanup, unsubscribe } = sessionProps(state)
  await render(RecapCard, props)
  expect(container.children).toHaveLength(0)
  state.recap = { bullets: ['Retained'] }
  state.open = false
  await render(RecapCard, props)
  expect(container.children).toHaveLength(0)
  expect(props.controller.observeSession).toHaveBeenCalledWith('session', {
    ready: true,
    running: false,
    latestTurn: 1,
  })
  expect(props.controller.mount).toHaveBeenCalledOnce()
  state.open = true
  await render(RecapCard, props)
  expect(container.querySelector('aside')).not.toBeNull()
  session.running = true
  await render(RecapCard, props)
  expect(container.children).toHaveLength(0)
  expect(cleanup).not.toHaveBeenCalled()
  session.blank = true
  await render(RecapCard, props)
  expect(cleanup).toHaveBeenCalledOnce()
  expect(unsubscribe).not.toHaveBeenCalled()
  await render(() => null)
  expect(unsubscribe).toHaveBeenCalledOnce()
  expect(
    document.querySelector('style[data-plugin-css="wombat9000-session-recap/recap"]'),
  ).toBeNull()
})

test('source settings container saves original payload and disposes its stylesheet', async () => {
  const rpc = {
    call: vi.fn(async (_, method, payload) =>
      method === 'models'
        ? { ok: true, value: { providers: [] } }
        : { ok: true, value: method === 'configure' ? payload : draft },
    ),
  }
  const controller = { invalidateSettings: vi.fn() }
  await render(SettingsCard, { rpc, controller })
  await click(page.getByRole('button', { name: 'Expand: Session recap' }))
  await click(page.getByRole('button', { name: 'Save', exact: true }))
  expect(rpc.call).toHaveBeenCalledWith('/session-recap', 'configure', draft)
  expect(controller.invalidateSettings).toHaveBeenCalledOnce()
  expect(container.textContent).toContain('Session recap settings saved.')
  expect(
    document.querySelector('style[data-plugin-css="wombat9000-session-recap/settings"]'),
  ).not.toBeNull()
  await render(() => null)
  expect(
    document.querySelector('style[data-plugin-css="wombat9000-session-recap/settings"]'),
  ).toBeNull()
})
