import { act } from 'react'
import { afterEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'
import { mountSlot } from './harness.mjs'

let fixture
afterEach(async () => { await fixture?.unmount(); fixture = undefined })
const screenshot = (name) => expect.element(page.getByTestId('fixture')).toMatchScreenshot(name)
const click = (locator) => act(async () => { await locator.click() })

test('expanded settings fits a narrow slot', async () => {
  fixture = await mountSlot('settings.plugin.item', { narrow: true })
  await click(page.getByRole('button', { name: 'Expand: Session recap' }))
  await expect.element(page.getByLabelText('Model ID')).toHaveValue('fixture-model')
  const element = page.getByTestId('fixture').element()
  expect(element.scrollWidth).toBe(element.clientWidth)
  await screenshot('settings-expanded-narrow')
})

test('recap error remains readable in a narrow dark slot', async () => {
  fixture = await mountSlot('conversation.input.dock', { narrow: true, dark: true, recapError: true })
  await click(page.getByRole('button', { name: 'Recap', exact: true }))
  await expect.element(page.getByRole('alert')).toHaveTextContent('The fixture provider is unavailable. Try again.')
  await screenshot('recap-error-narrow-dark')
})

test('blank conversation omits the recap slot', async () => {
  fixture = await mountSlot('conversation.input.dock', { blank: true })
  await expect.element(page.getByRole('textbox', { name: 'Message' })).toBeVisible()
  expect(document.querySelector('aside')).toBeNull()
  expect(fixture.rpc.call).not.toHaveBeenCalled()
  await screenshot('recap-blank')
})

test('nonblank conversation renders and generates a recap', async () => {
  fixture = await mountSlot('conversation.input.dock')
  await expect.element(page.getByRole('complementary', { name: 'Session recap' })).toBeVisible()
  await screenshot('recap-nonblank')
  await click(page.getByRole('button', { name: 'Recap', exact: true }))
  await expect.element(page.getByRole('status')).toBeVisible()
  expect(page.getByRole('status').element().textContent).toContain('Add reliable screenshot coverage')
  expect(fixture.rpc.call).toHaveBeenCalledWith('/session-recap', 'recap', { sessionId: 'fixture-session', automatic: false })
  await screenshot('recap-generated')
  await click(page.getByRole('button', { name: 'Dismiss session recap' }))
  await expect.element(page.getByRole('status')).not.toBeInTheDocument()
})

test('settings starts collapsed and preserves the draft across expansion', async () => {
  fixture = await mountSlot('settings.plugin.item')
  const expand = page.getByRole('button', { name: 'Expand: Session recap' })
  await expect.element(expand).toHaveAttribute('aria-expanded', 'false')
  await expect.element(page.getByRole('button', { name: 'Save', exact: true })).not.toBeInTheDocument()
  expect(document.querySelector('input, select')).toBeNull()
  await screenshot('settings-collapsed')
  await click(expand)
  await expect.element(page.getByRole('button', { name: 'Collapse: Session recap' })).toHaveAttribute('aria-expanded', 'true')
  await expect.element(page.getByLabelText('Provider ID')).toHaveValue('fixture-provider')
  await expect.element(page.getByRole('combobox', { name: 'Available models' })).toBeEnabled()
  await screenshot('settings-expanded')
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
