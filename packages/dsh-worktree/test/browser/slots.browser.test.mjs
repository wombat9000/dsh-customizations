import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { test, expect, vi } from 'vitest'
import { page } from 'vitest/browser'
let plugin
window.__ModuleLoader__ = { load: ({ factory }) => { plugin = factory(() => React) } }
await import('../../client.js')
delete window.__ModuleLoader__
globalThis.IS_REACT_ACT_ENVIRONMENT = true

test('themed layout is responsive and keeps details keyboard accessible', async () => {
  const f = await mount()
  try {
    const rich = snapshot()
    rich.repository = '/home/agent/workspace/dsh-customizations'
    rich.worktrees[0].name = 'worktrees-tab-design'
    rich.worktrees[0].branch = 'feat/worktrees-tab-design'
    rich.worktrees.push({ path: '/repo/main', name: 'dsh-customizations', branch: 'main', workerStatus: 'idle', changes: { count: 0 } })
    rich.selected.run.task = 'Review the Worktrees tab redesign, including accessibility and responsive layout.'
    f.set(rich); await f.click('Refresh')
    for (const theme of ['dark', 'light']) {
      f.container.style.cssText = `width:960px;background:${theme === 'dark' ? '#161616' : '#fafafa'};color:${theme === 'dark' ? '#eee' : '#222'};--dsw-alias-label-primary:${theme === 'dark' ? '#eee' : '#222'};--dsw-alias-label-secondary:${theme === 'dark' ? '#aaa' : '#666'}`
      expect(getComputedStyle(f.container.querySelector('.wt-layout')).gridTemplateColumns.split(' ').length).toBe(2)
      expect(f.container.querySelector('details')).toBeNull()
      f.container.querySelector('.wt-card').focus()
      expect(document.activeElement).toBe(f.container.querySelector('.wt-card'))
      await page.screenshot({ path: `../../../../artifacts/browser/worktrees-${theme}.png` })
    }
    f.container.style.width = '360px'
    expect(getComputedStyle(f.container.querySelector('.wt-layout')).gridTemplateColumns.split(' ').length).toBe(1)
    expect(f.container.scrollWidth).toBeLessThanOrEqual(360)
    await page.screenshot({ path: '../../../../artifacts/browser/worktrees-mobile.png' })
  } finally { await f.close() }
})

const snapshot = () => ({ sessionId: 'a', state: 'ready', repository: '/repo', worktrees: [
  { path: '/repo/a', name: 'a', branch: 'feature', workerStatus: 'busy', changes: { count: 1 }, latestAssignment: 'Review feature' },
], selected: { path: '/repo/a', changes: { count: 1, files: [{ path: 'file.txt', status: ' M' }] },
  runs: [{ id: 'new', mode: 'read-only', status: 'running' }, { id: 'old', mode: 'write', status: 'completed' }],
  run: { id: 'new', task: 'Review feature', report: null } } })

async function mount() {
  const listeners = new Set()
  let jobs = {}, value = snapshot(), deferred
  const rpc = { call: vi.fn(async (_channel, method, args) => {
    if (method === 'capability') return { ok: true, value: { sessionId: args.sessionId, state: 'ready' } }
    if (deferred) await deferred.promise
    const result = structuredClone(value)
    if (args.runId === 'old' && result.selected) result.selected.run = { id: 'old', task: 'Implement feature', report: 'Tests passed' }
    return result.state === 'error'
      ? { ok: false, error: { code: 'worktrees/read-failed', message: result.message, details: {} } }
      : { ok: true, value: result }
  }) }
  const sessions = { list: { getSnapshot: () => ({ current: 'a', jobsBySession: jobs }), subscribe: cb => { listeners.add(cb); return () => listeners.delete(cb) } } }
  let registration, dispose
  plugin.apply({ sessions, connection: { rpc }, slots: {
    inject: (_name, callback) => { dispose = callback() },
    register: (options, Component) => { registration = { options, Component }; return () => { registration = undefined } },
  } })
  await act(async () => {})
  expect(registration.options.id).toBe('worktrees')
  expect(registration.options.label).toBe('Worktrees')
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(React.createElement(registration.Component, registration.options.inject('a'))))
  return { container, rpc,
    set(value_) { value = value_ },
    async jobs() { jobs = {}; await act(async () => { for (const cb of listeners) cb() }) },
    defer() { let resolve; deferred = { promise: new Promise(r => { resolve = r }) }; return async () => { deferred = undefined; await act(async () => resolve()) } },
    async click(label) { const button = [...container.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') ?? b.textContent) === label); expect(button).toBeTruthy(); await act(async () => button.click()) },
    async close() { await act(async () => root.unmount()); dispose(); container.remove(); expect(listeners.size).toBe(0) },
  }
}

test('registered slot renders separate statuses, details, selection and in-place refresh', async () => {
  const f = await mount()
  try {
    expect(f.container.textContent).toContain('Worker: busy')
    expect(f.container.textContent).toContain('1 changed file')
    expect(f.container.textContent).toContain('file.txt')
    expect(f.container.textContent).toContain('This session’s recorded runs (2)')
    expect(f.container.textContent).not.toContain('About this view')
    await f.click('1. write · completed')
    expect(f.container.textContent).toContain('Tests passed')
    await f.click('Refresh')
    expect(f.rpc.call.mock.calls.at(-1)[2].runId).toBe('old')
    expect(f.container.textContent).toContain('Tests passed')
    await f.jobs()
    expect(f.container.textContent).toContain('Tests passed')
    expect([...f.container.querySelectorAll('button')].map(b => b.textContent).join(' ')).not.toMatch(/Dispatch|Cancel|Merge|Delete|Create/)
  } finally { await f.close() }
})

test('copy checkout path reports clipboard success and rejection, and selection clears feedback', async () => {
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  const f = await mount()
  try {
    await f.click('Copy checkout path')
    expect(writeText).toHaveBeenCalledWith('/repo/a')
    expect(f.container.textContent).toContain('Copied checkout path.')
    await f.click('a — feature')
    expect(f.container.textContent).not.toContain('Copied checkout path.')
    writeText.mockRejectedValueOnce(new Error('Permission denied'))
    await f.click('Copy checkout path')
    expect(f.container.textContent).toContain('Copy failed. Select and copy the path above.')
    expect(f.container.querySelector('h3').textContent).toBe('a')
    expect(f.container.querySelector('.wt-detail .wt-path').textContent).toBe('/repo/a')
    await f.click('Copy checkout path')
    expect(f.container.textContent).toContain('Copied checkout path.')
    expect(f.container.textContent).not.toContain('Copy failed.')
  } finally {
    await f.close()
    if (original) Object.defineProperty(navigator, 'clipboard', original)
    else delete navigator.clipboard
  }
})

test('initial load still presents a loading state', async () => {
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  let resolve
  const pending = new Promise(r => { resolve = r })
  const sessions = { list: { getSnapshot: () => ({ jobsBySession: {} }), subscribe: () => () => {} } }
  try {
    await act(async () => root.render(React.createElement(plugin.Panel, { sessionId: 'a', sessions, rpc: { call: () => pending } })))
    expect(container.textContent).toContain('Loading worktrees…')
    expect(container.querySelector('.wt-layout')).toBeNull()
    expect(container.querySelector('button').disabled).toBe(true)
    await act(async () => resolve({ ok: true, value: snapshot() }))
    expect(container.textContent).not.toContain('Loading worktrees…')
    expect(container.querySelector('.wt-layout')).toBeTruthy()
  } finally { await act(async () => root.unmount()); container.remove() }
})

test('refresh keeps layout stable; errors, unavailable and empty states remain explicit', async () => {
  const f = await mount()
  try {
    const layout = f.container.querySelector('.wt-layout')
    const before = layout.getBoundingClientRect().toJSON()
    const button = [...f.container.querySelectorAll('button')].find(b => b.textContent === 'Refresh')
    const buttonBefore = button.getBoundingClientRect().toJSON()
    button.focus()
    const release = f.defer()
    await f.click('Refresh')
    expect(f.container.textContent).not.toContain('Loading worktrees')
    expect(getComputedStyle(f.container.querySelector('.wt-refresh-status')).visibility).toBe('visible')
    expect(f.container.querySelector('.wt-layout')).toBe(layout)
    expect(layout.getBoundingClientRect().toJSON()).toEqual(before)
    expect(button.getBoundingClientRect().toJSON()).toEqual(buttonBefore)
    expect(button.disabled).toBe(false)
    expect(document.activeElement).toBe(button)
    await release()
    expect(layout.getBoundingClientRect().toJSON()).toEqual(before)
    expect(getComputedStyle(f.container.querySelector('.wt-refresh-status')).visibility).toBe('hidden')
    const finishJobRefresh = f.defer()
    await f.jobs()
    expect(layout.getBoundingClientRect().toJSON()).toEqual(before)
    expect(f.container.textContent).not.toContain('Loading worktrees')
    await finishJobRefresh()
    for (const [value, text] of [
      [{ sessionId: 'a', state: 'error', message: 'private host details' }, 'Worktrees could not refresh. Try again.'],
      [{ sessionId: 'a', state: 'unavailable' }, 'unavailable for this session'],
      [{ sessionId: 'a', state: 'disabled' }, 'unavailable for this session'],
      [{ sessionId: 'a', state: 'ready', worktrees: [], selected: null }, 'No worktrees found'],
      [{ ...snapshot(), selected: { path: '/repo/a', changes: { count: 0, files: [] }, runs: [], run: null } }, 'No recorded runs'],
    ]) {
      f.set(value); await f.click('Refresh')
      expect(f.container.textContent).toContain(text)
      expect(f.container.textContent).not.toContain('private host details')
      if (value.state === 'error') {
        expect(f.container.querySelector('[role="alert"]')).toBeTruthy()
        expect(f.container.textContent).not.toContain('No worktrees found')
        expect(f.container.textContent).not.toContain('Review feature')
      }
    }
  } finally { await f.close() }
})
