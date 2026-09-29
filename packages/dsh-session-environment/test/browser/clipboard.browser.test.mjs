import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { page } from 'vitest/browser'
import bundle from '../../lib/client.js?raw'

// Use the existing generated loader boundary with real React, not fake hooks.
function loadClient(source) {
  let client
  const previous = window.__ModuleLoader__
  window.__ModuleLoader__ = {
    load({ factory }) {
      client = factory((name) => {
        if (name === 'react') return React
        throw new Error(`Unexpected external: ${name}`)
      })
    },
  }
  try {
    new Function(source)()
  } finally {
    if (previous === undefined) delete window.__ModuleLoader__
    else window.__ModuleLoader__ = previous
  }
  return client
}

const client = loadClient(bundle)
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root
let container

afterEach(async () => {
  if (root) await act(async () => root.unmount())
  container?.remove()
  root = undefined
  vi.restoreAllMocks()
})

for (const [label, value] of [
  ['CWD', '/home/test/projects/very-long-directory'],
  ['branch name', 'feat/very-long-branch-name'],
]) {
  for (const failure of [false, true]) {
    test(`${label} copies the full value and renders ${failure ? 'failure' : 'success'} feedback`, async () => {
      let settle
      const copied = vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            settle = () => (failure ? reject(new Error('Permission denied')) : resolve())
          }),
      )
      container = document.createElement('main')
      document.body.append(container)
      root = createRoot(container)
      await act(async () => {
        root.render(React.createElement(client.CopyValue, { label, value }, '…shortened'))
      })
      const button = page.getByRole('button', { name: `Copy ${label}: ${value}`, exact: true })
      await expect.element(button).toHaveAttribute('type', 'button')
      await expect.element(button).toHaveTextContent('…shortened')
      const status = page.getByRole('status')
      await expect.element(status).toHaveAttribute('aria-live', 'polite')
      expect(status.element().textContent).toBe('')
      await act(async () => button.click())
      expect(copied.mock.calls).toEqual([[value]])
      expect(status.element().textContent).toBe('')
      await act(async () => settle())
      await expect
        .element(status)
        .toHaveTextContent(failure ? `Could not copy ${label}. Try again.` : `${label} copied`)
      await expect.element(status).toBeVisible()
    })
  }
}
