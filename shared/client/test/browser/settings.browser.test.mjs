import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { SettingsField, SettingsPanel } from '../../settings.tsx'

// The shared presentation owns keyboard, labels, feedback and style lifetime.
// Consumer suites own transport, credential and draft behavior.
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mounts = []
afterEach(async () => {
  for (const mount of mounts.splice(0)) {
    if (mount.root) await act(() => mount.root.unmount())
    mount.container.remove()
  }
})
async function mount(props = {}) {
  const container = document.createElement('div')
  // Browser Mode has no DSH theme; supply only the token needed for focus styling.
  container.style.setProperty('--dsw-alias-brand-primary', 'blue')
  document.body.append(container)
  const root = createRoot(container)
  const result = { root, container }
  mounts.push(result)
  await act(() =>
    root.render(
      React.createElement(SettingsPanel, {
        title: 'Fixture',
        initiallyOpen: false,
        status: 'Checking fixture…',
        description: 'Fixture description',
        actions: React.createElement('button', { type: 'button', disabled: true }, 'Save'),
        children: React.createElement(SettingsField, {
          label: 'Fixture value',
          hint: 'Fixture help',
          defaultValue: 'Draft',
        }),
        ...props,
      }),
    ),
  )
  return result
}

test('native disclosure supports keyboard focus, field labels and literal feedback', async () => {
  const hostile = '<img src=x onerror="alert(1)">'
  const { container } = await mount({ status: hostile, error: hostile, notice: hostile })
  const details = container.querySelector('details')
  const summary = container.querySelector('summary')
  const input = container.querySelector('input')
  expect(details.open).toBe(false)
  await act(() => userEvent.keyboard('{Tab}'))
  expect(document.activeElement).toBe(summary)
  expect(getComputedStyle(summary).outlineStyle).toBe('solid')
  await act(() => userEvent.keyboard('{Enter}'))
  expect(details.open).toBe(true)
  await act(() => userEvent.keyboard('{Tab}'))
  await expect.element(page.getByLabelText('Fixture value')).toHaveFocus()
  expect(getComputedStyle(input).outlineStyle).toBe('solid')
  expect(document.getElementById(input.getAttribute('aria-describedby')).textContent).toBe(
    'Fixture help',
  )
  await expect.element(page.getByRole('button', { name: 'Save' })).toBeDisabled()
  expect(getComputedStyle(container.querySelector('button')).opacity).toBe('0.5')
  await expect.element(page.getByRole('alert')).toHaveTextContent(hostile)
  for (const status of container.querySelectorAll('[role=status]')) {
    expect(status.textContent).toBe(hostile)
  }
  expect(container.querySelector('img')).toBeNull()
  // Closing through the keyboard leaves the native disclosure control focused.
  summary.focus()
  await act(() => userEvent.keyboard(' '))
  expect(details.open).toBe(false)
  expect(document.activeElement).toBe(summary)
})

test('concurrent panels keep independent labels, disclosure and styles after sibling unmount', async () => {
  const outside = document.createElement('button')
  outside.textContent = 'Unrelated control'
  document.body.append(outside)
  try {
    const outsideStyle = getComputedStyle(outside).borderRadius
    const first = await mount({ title: 'First', initiallyOpen: true })
    const second = await mount({
      title: 'Second',
      initiallyOpen: true,
      actionLayout: 'stacked-end',
    })
    const firstInput = first.container.querySelector('input')
    const secondInput = second.container.querySelector('input')
    expect(firstInput.id).not.toBe(secondInput.id)
    expect(second.container.querySelector('label').control).toBe(secondInput)
    expect(first.container.querySelector('details').open).toBe(true)
    const row = getComputedStyle(first.container.querySelector('button').parentElement)
    const stacked = getComputedStyle(second.container.querySelector('button').parentElement)
    expect(row.display).toBe('flex')
    expect(row.flexWrap).toBe('wrap')
    expect(stacked.display).toBe('grid')
    expect(stacked.justifyItems).toBe('end')
    const before = getComputedStyle(secondInput).borderRadius
    expect(before).toBe('8px')
    expect(getComputedStyle(outside).borderRadius).toBe(outsideStyle)
    await act(() => first.root.unmount())
    first.root = null
    expect(first.container.querySelector('style')).toBeNull()
    expect(getComputedStyle(secondInput).borderRadius).toBe(before)
    expect(second.container.querySelector('details').open).toBe(true)
    second.container.querySelector('label').click()
    expect(document.activeElement).toBe(secondInput)
    await act(() => second.root.unmount())
    second.root = null
    expect(second.container.querySelector('style')).toBeNull()
    expect(getComputedStyle(outside).borderRadius).toBe(outsideStyle)
  } finally {
    outside.remove()
  }
})
