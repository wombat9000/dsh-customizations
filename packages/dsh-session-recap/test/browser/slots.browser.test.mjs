import { act } from 'react'
import { afterEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'
import { mountSlot } from './harness.mjs'

// Fast component interactions use mocked RPC. Visual assertions belong to test/real-ui.
let fixture
afterEach(async () => { await fixture?.unmount(); fixture = undefined })
const click = (locator) => act(async () => { await locator.click() })

test('settings owns a scoped stylesheet and removes it on unmount', async () => {
  fixture = await mountSlot('settings.plugin.item')
  const selector = 'style[data-plugin-css="wombat9000-session-recap/settings"]'
  const style = document.querySelector(selector)
  expect(style).not.toBeNull()
  const check = (rules) => {
    for (const rule of rules) {
      if (rule.selectorText) {
        for (const selector of rule.selectorText.split(',')) expect(selector.trim()).toMatch(/^\.dsh-session-recap-settings(?:\b|__)/)
      } else if (rule.cssRules) check(rule.cssRules)
    }
  }
  check(style.sheet.cssRules)
  expect(page.getByRole('button', { name: 'Expand: Session recap' }).element().querySelector('svg[aria-hidden="true"]')).not.toBeNull()
  await fixture.unmount()
  fixture = undefined
  expect(document.querySelector(selector)).toBeNull()
})

test('expanded settings fits a narrow slot', async () => {
  fixture = await mountSlot('settings.plugin.item', { narrow: true })
  await click(page.getByRole('button', { name: 'Expand: Session recap' }))
  await expect.element(page.getByLabelText('Model ID')).toHaveValue('fixture-model')
  const element = page.getByTestId('fixture').element()
  expect(element.scrollWidth).toBe(element.clientWidth)
})

test('recap errors are exposed as alerts', async () => {
  fixture = await mountSlot('conversation.input.dock', { recapError: true })
  await click(page.getByRole('button', { name: 'Generate recap', exact: true }))
  await expect.element(page.getByRole('alert')).toHaveTextContent('The fixture provider is unavailable. Try again.')
  await expect.element(page.getByRole('button', { name: 'Retry recap', exact: true })).toHaveAttribute('title', 'Retry recap: The fixture provider is unavailable. Try again.')
  await fixture.sent()
  await expect.element(page.getByRole('complementary', { name: 'Session recap' })).not.toBeInTheDocument()
  await click(page.getByRole('button', { name: 'Generate recap', exact: true }))
  await expect.element(page.getByRole('alert')).toBeVisible()
  expect(fixture.rpc.call.mock.calls.filter(([, method]) => method === 'recap')).toHaveLength(2)
})

test('blank conversation omits the recap slot', async () => {
  fixture = await mountSlot('conversation.input.dock', { blank: true })
  await expect.element(page.getByRole('textbox', { name: 'Message' })).toBeVisible()
  expect(document.querySelector('aside')).toBeNull()
  await expect.element(page.getByRole('button', { name: 'Generate recap', exact: true })).not.toBeInTheDocument()
  expect(fixture.rpc.call).not.toHaveBeenCalled()
})

test('latest assistant action generates a hidden-until-ready recap and regenerates after a persisted human message', async () => {
  fixture = await mountSlot('conversation.input.dock')
  await expect.element(page.getByRole('complementary', { name: 'Session recap' })).not.toBeInTheDocument()
  expect(page.getByTestId('session-dock').element().textContent).toBe('')
  expect(page.getByTestId('session-header').element().querySelector('button')).toBeNull()
  expect(page.getByTestId('assistant-actions-1').element().querySelector('.dsh-session-recap-action')).toBeNull()
  expect(page.getByTestId('assistant-actions-2').element().querySelector('.dsh-session-recap-action')).not.toBeNull()
  expect(page.getByRole('button', { name: 'Copy', exact: true }).elements()).toHaveLength(2)
  await click(page.getByRole('button', { name: 'Generate recap', exact: true }))
  await expect.element(page.getByRole('status')).toBeVisible()
  expect(page.getByRole('status').element().textContent).toContain('Add reliable screenshot coverage')
  expect(fixture.rpc.call).toHaveBeenCalledWith('/session-recap', 'recap', { sessionId: 'fixture-session', automatic: false })
  await fixture.sent()
  await expect.element(page.getByRole('status')).not.toBeInTheDocument()
  await expect.element(page.getByRole('complementary', { name: 'Session recap' })).not.toBeInTheDocument()
  await click(page.getByRole('button', { name: 'Generate recap', exact: true }))
  await expect.element(page.getByRole('status')).toBeVisible()
  expect(fixture.rpc.call.mock.calls.filter(([, method]) => method === 'recap')).toHaveLength(2)
  expect(page.getByTestId('session-dock').element().querySelectorAll('button')).toHaveLength(0)
})

test('typing keeps the recap; another session send does not hide it', async () => {
  fixture = await mountSlot('conversation.input.dock')
  await click(page.getByRole('button', { name: 'Generate recap', exact: true }))
  await act(async () => page.getByRole('textbox', { name: 'Message' }).fill('Draft only'))
  await expect.element(page.getByRole('status')).toBeVisible()
  await fixture.sent('another-session')
  await expect.element(page.getByRole('status')).toBeVisible()
  const panel = page.getByRole('complementary', { name: 'Session recap' }).element()
  expect(panel.querySelectorAll('li')).toHaveLength(3)
  expect(panel.querySelector('button, svg, small, strong, h2')).toBeNull()
  expect(panel.textContent).not.toMatch(/Earlier recap|Goal:|Latest outcome:|Next step:/)
  await fixture.sent()
  await expect.element(page.getByRole('status')).not.toBeInTheDocument()
})

test('successful send suppresses an in-flight recap and permits a fresh request', async () => {
  fixture = await mountSlot('conversation.input.dock', { deferRecap: true })
  await click(page.getByRole('button', { name: 'Generate recap', exact: true }))
  await fixture.sent()
  await expect.element(page.getByRole('complementary', { name: 'Session recap' })).not.toBeInTheDocument()
  await fixture.resolveRecap()
  await expect.element(page.getByRole('complementary', { name: 'Session recap' })).not.toBeInTheDocument()
  await click(page.getByRole('button', { name: 'Generate recap', exact: true }))
  await fixture.resolveRecap()
  await expect.element(page.getByRole('status')).toBeVisible()
})

test('assistant action and dock isolate pending responses across session switches', async () => {
  fixture = await mountSlot('conversation.input.dock', { deferRecap: true, recapTopic: (id) => `Goal for ${id}.` })
  await click(page.getByRole('button', { name: 'Generate recap', exact: true }))
  await expect.element(page.getByRole('button', { name: 'Open recap when ready', exact: true })).toBeEnabled()
  await expect.element(page.getByRole('complementary', { name: 'Session recap' })).not.toBeInTheDocument()
  await fixture.switchSession('second-session')
  await expect.element(page.getByRole('button', { name: 'Generate recap', exact: true })).toBeEnabled()
  await expect.element(page.getByRole('complementary', { name: 'Session recap' })).not.toBeInTheDocument()
  await fixture.resolveRecap('fixture-session')
  await expect.element(page.getByRole('complementary', { name: 'Session recap' })).not.toBeInTheDocument()
  await click(page.getByRole('button', { name: 'Generate recap', exact: true }))
  await expect.element(page.getByRole('complementary', { name: 'Session recap' })).not.toBeInTheDocument()
  await fixture.switchSession('fixture-session')
  const statusText = () => page.getByRole('status').element().textContent
  await expect.poll(statusText).toContain('Goal for fixture-session.')
  expect(statusText()).not.toContain('Goal for second-session.')
  await expect.element(page.getByRole('button', { name: 'Hide recap', exact: true })).toBeEnabled()
  await fixture.resolveRecap('second-session')
  expect(statusText()).toContain('Goal for fixture-session.')
  await fixture.switchSession('second-session')
  await expect.poll(statusText).toContain('Goal for second-session.')
  expect(statusText()).not.toContain('Goal for fixture-session.')
  expect(fixture.rpc.call.mock.calls.filter(([, method]) => method === 'recap').map(([, , payload]) => payload.sessionId)).toEqual(['fixture-session', 'second-session'])
})

test('automatic readiness glows without animation or panel, and toggles reuse the result', async () => {
  fixture = await mountSlot('conversation.input.dock', { autoRecap: true })
  const show = page.getByRole('button', { name: 'Show recap', exact: true })
  await expect.element(show).toHaveAttribute('data-unread', 'true')
  await expect.element(page.getByRole('complementary', { name: 'Session recap' })).not.toBeInTheDocument()
  const button = show.element()
  const icon = button.querySelector('svg')
  expect(getComputedStyle(icon).filter).toContain('drop-shadow')
  expect(getComputedStyle(icon).animationName).toBe('none')
  expect(getComputedStyle(button, '::after').animationName).toBe('none')
  expect(button.textContent).toBe('')
  await click(show)
  await expect.element(page.getByRole('status')).toBeVisible()
  const hide = page.getByRole('button', { name: 'Hide recap', exact: true })
  await expect.element(hide).toHaveAttribute('aria-expanded', 'true')
  await expect.element(hide).toHaveAttribute('data-unread', 'false')
  expect(getComputedStyle(icon).filter).toBe('none')
  await click(hide)
  await expect.element(page.getByRole('complementary', { name: 'Session recap' })).not.toBeInTheDocument()
  await click(show)
  await expect.element(page.getByRole('status')).toBeVisible()
  expect(fixture.rpc.call.mock.calls.filter(([, method]) => method === 'recap')).toHaveLength(1)
})

test('busy automatic clicks request opening on readiness without duplicate calls or a loading panel', async () => {
  fixture = await mountSlot('conversation.input.dock', { autoRecap: true, deferRecap: true })
  const busy = page.getByRole('button', { name: 'Open recap when ready', exact: true })
  await expect.element(busy).toHaveAttribute('data-busy', 'true')
  await expect.element(busy).toBeEnabled()
  await expect.element(page.getByRole('complementary', { name: 'Session recap' })).not.toBeInTheDocument()
  // This suite pins reduced motion. Inspect computed pseudo-element styles, not just source text.
  expect(matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true)
  const shimmer = getComputedStyle(busy.element(), '::after')
  expect(shimmer.animationName).toBe('none')
  expect(shimmer.borderBottomStyle).toBe('solid')
  const rules = [...document.querySelector('style[data-plugin-css="wombat9000-session-recap/recap"]').sheet.cssRules]
  expect(rules.some(rule => rule.name === 'dsh-session-recap-shimmer')).toBe(true)
  expect(rules.some(rule => rule.selectorText?.includes('[data-busy="true"]::after') && rule.style.animationName === 'dsh-session-recap-shimmer')).toBe(true)
  await click(busy); await click(busy)
  expect(fixture.rpc.call.mock.calls.filter(([, method]) => method === 'recap')).toHaveLength(1)
  await fixture.resolveRecap()
  await expect.element(page.getByRole('status')).toBeVisible()
  await expect.element(page.getByRole('button', { name: 'Hide recap', exact: true })).toHaveAttribute('data-unread', 'false')
})

test('manual busy clicks remain enabled and open only when ready', async () => {
  fixture = await mountSlot('conversation.input.dock', { deferRecap: true })
  await click(page.getByRole('button', { name: 'Generate recap', exact: true }))
  await expect.element(page.getByRole('complementary', { name: 'Session recap' })).not.toBeInTheDocument()
  await click(page.getByRole('button', { name: 'Open recap when ready', exact: true }))
  expect(fixture.rpc.call.mock.calls.filter(([, method]) => method === 'recap')).toHaveLength(1)
  await fixture.resolveRecap()
  await expect.element(page.getByRole('status')).toBeVisible()
})

test('new running and completed turns invalidate recaps without a human-send event', async () => {
  fixture = await mountSlot('conversation.input.dock')
  await click(page.getByRole('button', { name: 'Generate recap', exact: true }))
  await fixture.setTurnState({ running: true, closed: false, turn: 3 })
  await expect.element(page.getByRole('complementary', { name: 'Session recap' })).not.toBeInTheDocument()
  expect(document.querySelector('.dsh-session-recap-action')).toBeNull()
  await fixture.setTurnState({ running: false, closed: true })
  await click(page.getByRole('button', { name: 'Generate recap', exact: true }))
  await expect.element(page.getByRole('status')).toBeVisible()
  await fixture.setTurnState({ turn: 4 })
  await expect.element(page.getByRole('complementary', { name: 'Session recap' })).not.toBeInTheDocument()
  await expect.element(page.getByRole('button', { name: 'Generate recap', exact: true })).toBeVisible()
})

test('running hook invalidates a recap before a new timeline turn appears', async () => {
  fixture = await mountSlot('conversation.input.dock')
  await click(page.getByRole('button', { name: 'Generate recap', exact: true }))
  await fixture.setTurnState({ running: true })
  await expect.element(page.getByRole('complementary', { name: 'Session recap' })).not.toBeInTheDocument()
  await fixture.setTurnState({ running: false })
  await expect.element(page.getByRole('button', { name: 'Generate recap', exact: true })).toBeVisible()
})

test('dock remount preserves a ready recap but loaded newer history invalidates it', async () => {
  fixture = await mountSlot('conversation.input.dock')
  await click(page.getByRole('button', { name: 'Generate recap', exact: true }))
  await fixture.remount()
  await expect.element(page.getByRole('status')).toBeVisible()
  expect(fixture.rpc.call.mock.calls.filter(([, method]) => method === 'recap')).toHaveLength(1)
  await fixture.setTurnState({ loaded: false, turn: 3 })
  await fixture.remount()
  await fixture.setTurnState({ loaded: true })
  await expect.element(page.getByRole('complementary', { name: 'Session recap' })).not.toBeInTheDocument()
  await expect.element(page.getByRole('button', { name: 'Generate recap', exact: true })).toBeVisible()
})

test('new turn suppresses a late automatic result and its unread indicator', async () => {
  fixture = await mountSlot('conversation.input.dock', { autoRecap: true, deferRecap: true })
  await expect.element(page.getByRole('button', { name: 'Open recap when ready', exact: true })).toBeVisible()
  await fixture.setTurnState({ turn: 3, running: true, closed: false })
  await fixture.resolveRecap()
  await fixture.setTurnState({ running: false, closed: true })
  await expect.element(page.getByRole('complementary', { name: 'Session recap' })).not.toBeInTheDocument()
  await expect.element(page.getByRole('button', { name: 'Generate recap', exact: true })).toHaveAttribute('data-unread', 'false')
})

test('headline is a single-line accessible heading above unchanged details at narrow widths', async () => {
  const headline = 'Google Drive: shared-file picker and invoice export with preserved permissions'
  fixture = await mountSlot('conversation.input.dock', { narrow: true, recapHeadline: headline })
  await click(page.getByRole('button', { name: 'Generate recap', exact: true }))
  const heading = page.getByRole('heading', { name: headline, level: 2 })
  await expect.element(heading).toBeVisible()
  await expect.element(heading).toHaveAttribute('title', headline)
  const element = heading.element()
  expect(element.nextElementSibling.tagName).toBe('UL')
  expect(element.nextElementSibling.querySelectorAll('li')).toHaveLength(3)
  expect(element.nextElementSibling.textContent).toContain('Add reliable screenshot coverage for Session recap.')
  expect(getComputedStyle(element).whiteSpace).toBe('nowrap')
  expect(getComputedStyle(element).textOverflow).toBe('ellipsis')
  expect(element.scrollWidth).toBeGreaterThan(element.clientWidth)
  const panel = page.getByRole('complementary', { name: 'Session recap' }).element()
  expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth)
})
test('headline stays plain text, never interpreted as markup', async () => {
  const headline = '<img src=x onerror=alert(1)> Drive picker'
  fixture = await mountSlot('conversation.input.dock', { recapHeadline: headline })
  await click(page.getByRole('button', { name: 'Generate recap', exact: true }))
  await expect.element(page.getByRole('heading', { name: headline, level: 2 })).toBeVisible()
  expect(document.querySelector('.dsh-session-recap-card img')).toBeNull()
})

test('narrow recap panel wraps long text without horizontal overflow', async () => {
  fixture = await mountSlot('conversation.input.dock', { narrow: true, recapTopic: 'unbroken'.repeat(150) })
  await click(page.getByRole('button', { name: 'Generate recap', exact: true }))
  await expect.element(page.getByRole('status')).toBeVisible()
  for (const element of [page.getByTestId('fixture').element(), page.getByTestId('session-dock').element(), page.getByRole('complementary', { name: 'Session recap' }).element()]) {
    expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth)
  }
})

test('recap panel inherits chat width and composer clearance and removes its styles on unmount', async () => {
  fixture = await mountSlot('conversation.input.dock')
  const host = page.getByTestId('fixture').element()
  host.style.setProperty('--dsh-chat-content-width', '260px')
  host.style.setProperty('--dsh-composer-side-clearance', '24px')
  await click(page.getByRole('button', { name: 'Generate recap', exact: true }))
  const panel = page.getByRole('complementary', { name: 'Session recap' }).element()
  const dock = page.getByTestId('session-dock').element()
  expect(panel.getBoundingClientRect().width).toBeCloseTo(260, 0)
  host.style.setProperty('--dsh-chat-content-width', '1000px')
  expect(panel.getBoundingClientRect().width).toBeCloseTo(dock.clientWidth - 2 * 24 - 32, 0)
  const panelBounds = panel.getBoundingClientRect()
  const dockBounds = dock.getBoundingClientRect()
  expect(panelBounds.left - dockBounds.left).toBeCloseTo(dockBounds.right - panelBounds.right, 0)
  const selector = 'style[data-plugin-css="wombat9000-session-recap/recap"]'
  expect(document.querySelector(selector)).not.toBeNull()
  await fixture.unmount()
  fixture = undefined
  expect(document.querySelector(selector)).toBeNull()
})

test('settings starts collapsed and preserves the draft across expansion', async () => {
  fixture = await mountSlot('settings.plugin.item')
  const expand = page.getByRole('button', { name: 'Expand: Session recap' })
  await expect.element(expand).toHaveAttribute('aria-expanded', 'false')
  await expect.element(page.getByRole('button', { name: 'Save', exact: true })).not.toBeInTheDocument()
  expect(document.querySelector('input, select')).toBeNull()
  await click(expand)
  await expect.element(page.getByRole('button', { name: 'Collapse: Session recap' })).toHaveAttribute('aria-expanded', 'true')
  await expect.element(page.getByLabelText('Provider ID')).toHaveValue('fixture-provider')
  await expect.element(page.getByRole('combobox', { name: 'Available models' })).toBeEnabled()
  await act(async () => { await page.getByLabelText('Model ID').fill('edited-model') })
  await click(page.getByRole('button', { name: 'Collapse: Session recap' }))
  await expect.element(page.getByLabelText('Model ID')).not.toBeInTheDocument()
  await click(expand)
  await expect.element(page.getByLabelText('Model ID')).toHaveValue('edited-model')
  await click(page.getByRole('button', { name: 'Save', exact: true }))
  await expect.element(page.getByRole('status')).toHaveTextContent('Session recap settings saved.')
  expect(fixture.rpc.call).toHaveBeenCalledWith('/session-recap', 'configure', {
    autoRecap: false, inactivityMinutes: 30, provider: 'fixture-provider', model: 'edited-model',
  })
})
