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
  await click(page.getByRole('button', { name: 'Recap', exact: true }))
  await expect.element(page.getByRole('alert')).toHaveTextContent('The fixture provider is unavailable. Try again.')
  await click(page.getByRole('button', { name: 'Dismiss session recap' }))
  await expect.element(page.getByRole('complementary', { name: 'Session recap' })).not.toBeInTheDocument()
  await click(page.getByRole('button', { name: 'Recap', exact: true }))
  await expect.element(page.getByRole('alert')).toBeVisible()
  expect(fixture.rpc.call.mock.calls.filter(([, method]) => method === 'recap')).toHaveLength(2)
})

test('blank conversation omits the recap slot', async () => {
  fixture = await mountSlot('conversation.input.dock', { blank: true })
  await expect.element(page.getByRole('textbox', { name: 'Message' })).toBeVisible()
  expect(document.querySelector('aside')).toBeNull()
  await expect.element(page.getByRole('button', { name: 'Recap', exact: true })).not.toBeInTheDocument()
  expect(fixture.rpc.call).not.toHaveBeenCalled()
})

test('header generates a recap into an initially absent panel and regenerates after dismissal', async () => {
  fixture = await mountSlot('conversation.input.dock')
  await expect.element(page.getByRole('complementary', { name: 'Session recap' })).not.toBeInTheDocument()
  expect(page.getByTestId('session-dock').element().textContent).toBe('')
  expect(page.getByTestId('session-header').element().querySelector('button').textContent).toBe('Recap')
  await click(page.getByRole('button', { name: 'Recap', exact: true }))
  await expect.element(page.getByRole('status')).toBeVisible()
  expect(page.getByRole('status').element().textContent).toContain('Add reliable screenshot coverage')
  expect(fixture.rpc.call).toHaveBeenCalledWith('/session-recap', 'recap', { sessionId: 'fixture-session', automatic: false })
  await click(page.getByRole('button', { name: 'Dismiss session recap' }))
  await expect.element(page.getByRole('status')).not.toBeInTheDocument()
  await expect.element(page.getByRole('complementary', { name: 'Session recap' })).not.toBeInTheDocument()
  await click(page.getByRole('button', { name: 'Recap', exact: true }))
  await expect.element(page.getByRole('status')).toBeVisible()
  expect(fixture.rpc.call.mock.calls.filter(([, method]) => method === 'recap')).toHaveLength(2)
  expect(page.getByTestId('session-dock').element().querySelectorAll('button')).toHaveLength(1)
})

test('header and dock share busy state and isolate pending responses across session switches', async () => {
  fixture = await mountSlot('conversation.input.dock', { deferRecap: true, recapGoal: (id) => `Goal for ${id}.` })
  await click(page.getByRole('button', { name: 'Recap', exact: true }))
  await expect.element(page.getByRole('button', { name: 'Recapping…', exact: true })).toBeDisabled()
  await expect.element(page.getByRole('status')).toHaveTextContent('Generating recap…')
  await fixture.switchSession('second-session')
  await expect.element(page.getByRole('button', { name: 'Recap', exact: true })).toBeEnabled()
  await expect.element(page.getByRole('complementary', { name: 'Session recap' })).not.toBeInTheDocument()
  await fixture.resolveRecap('fixture-session')
  await expect.element(page.getByRole('complementary', { name: 'Session recap' })).not.toBeInTheDocument()
  await click(page.getByRole('button', { name: 'Recap', exact: true }))
  await expect.element(page.getByRole('status')).toHaveTextContent('Generating recap…')
  await fixture.switchSession('fixture-session')
  const statusText = () => page.getByRole('status').element().textContent
  await expect.poll(statusText).toContain('Goal for fixture-session.')
  expect(statusText()).not.toContain('Goal for second-session.')
  await expect.element(page.getByRole('button', { name: 'Recap', exact: true })).toBeEnabled()
  await fixture.resolveRecap('second-session')
  expect(statusText()).toContain('Goal for fixture-session.')
  await fixture.switchSession('second-session')
  await expect.poll(statusText).toContain('Goal for second-session.')
  expect(statusText()).not.toContain('Goal for fixture-session.')
  expect(fixture.rpc.call.mock.calls.filter(([, method]) => method === 'recap').map(([, , payload]) => payload.sessionId)).toEqual(['fixture-session', 'second-session'])
})

test('narrow recap panel wraps long text without horizontal overflow', async () => {
  fixture = await mountSlot('conversation.input.dock', { narrow: true, recapGoal: 'unbroken'.repeat(150) })
  await click(page.getByRole('button', { name: 'Recap', exact: true }))
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
  await click(page.getByRole('button', { name: 'Recap', exact: true }))
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
