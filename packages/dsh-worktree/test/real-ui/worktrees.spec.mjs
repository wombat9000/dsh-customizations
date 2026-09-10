import { test, expect, pluginSettings, openSeededSession } from '../../../../tests/real-ui/fixtures.mjs'
import { execFileSync } from 'node:child_process'
import { realpathSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const repo = realpathSync(fileURLToPath(new URL('../../../../', import.meta.url)))

// Opt-in local comparison capture; CI always executes baseline assertions.
const beforeRef = process.env.WORKTREES_BEFORE_REF
if (beforeRef && process.env.CI) throw new Error('Before-image capture is not permitted in CI')
const beforeClient = beforeRef ? execFileSync('git', ['-c', 'safe.directory=', '-c', `safe.directory=${repo}`, 'show', `${beforeRef}:packages/dsh-worktree/client.js`], { cwd: repo, encoding: 'utf8' }) : undefined

// Real shell, plugin bundle and theme; fixed RPC data avoids host paths, process
// history and Git timing in pixel baselines. Transport has its own Node tests.
for (const [theme, narrow] of [['light', false], ['dark', false], ['light', true]]) {
  test(`Worktrees layout (${theme}${narrow ? ', narrow' : ''})`, async ({ app }) => {
    // Keep the whole panel within the shell's visible area, including the
    // stacked detail pane, rather than snapshotting content clipped by ancestors.
    await app.setViewportSize({ width: 1100, height: narrow ? 1800 : 1150 })
    await app.route('**/local-worktrees/*', async route => {
      const request = route.request().postDataJSON()
      const { sessionId, path, runId } = request.payload
      const worktrees = [
        { path: '/workspace/design', name: 'worktrees-tab-design', branch: 'feat/worktrees-tab-design', workerStatus: 'busy', changes: { count: 2 }, latestAssignment: 'Review the Worktrees layout, keyboard navigation, and responsive behavior.' },
        { path: '/workspace/main', name: 'dsh-customizations', branch: 'main', workerStatus: 'idle', changes: { count: 0 } },
        { path: '/workspace/skills', name: 'coordinator-skills', branch: 'feat/coordinator-skills', workerStatus: 'completed', changes: { count: 0 }, latestAssignment: 'Add conditional Creator skill guidance.' },
      ]
      const selected = worktrees.find(row => row.path === path) ?? worktrees[0]
      const value = request.method === 'capability' ? { sessionId, state: 'ready' } : {
        sessionId, state: 'ready', repository: '/workspace/dsh-customizations', worktrees,
        selected: { path: selected.path, changes: { count: 2, files: [{ path: 'packages/dsh-worktree/client.js', status: ' M' }, { path: 'packages/dsh-worktree/test/browser/slots.browser.test.mjs', status: ' M' }] },
          runs: [{ id: 'review', mode: 'read-only', status: 'running' }, { id: 'implement', mode: 'write', status: 'completed' }],
          run: runId === 'implement' ? { id: 'implement', task: 'Implement the Worktrees tab redesign.', report: 'All checks passed.' } : { id: 'review', task: 'Review the Worktrees tab redesign. Check session isolation, keyboard focus, and narrow layouts.', report: null },
        },
      }
      await route.fulfill({ json: { type: 'server-response', rpcId: request.rpcId, result: { ok: true, value } } })
    })
    if (beforeClient) {
      const origin = new URL(app.url()).origin
      await app.route('**/*', async route => {
        if (new URL(route.request().url()).origin !== origin || route.request().resourceType() !== 'script') return route.fallback()
        const response = await route.fetch()
        const body = await response.text()
        if (body.includes("id: '@local/dsh-worktree'")) {
          const currentClient = readFileSync(new URL('../../client.js', import.meta.url), 'utf8')
          if (!body.includes(currentClient)) throw new Error('Cannot locate exact Worktrees source in combined bundle')
          await route.fulfill({ response, body: body.replace(currentClient, () => beforeClient) })
        }
        else await route.fulfill({ response })
      })
      await app.reload()
      await app.getByRole('button', { name: 'Configure later', exact: true }).click()
    }
    const settings = await pluginSettings(app, theme)
    await settings.getByRole('button', { name: 'Close', exact: true }).click()
    await openSeededSession(app)
    await app.getByRole('tab', { name: 'Worktrees', exact: true }).click()
    const panel = app.getByRole('region', { name: 'Worktrees', exact: true })
    await expect(panel.getByRole('heading', { name: 'Full assignment', exact: true })).toBeVisible()
    await app.evaluate(() => document.fonts.ready)
    // Resize the slot itself so sidebar behavior cannot mask the narrow-layout
    // container query. The actual DSH shell and theme remain mounted.
    if (narrow) await panel.evaluate(element => { element.style.width = '390px' })
    await expect(panel.getByText('Loading worktrees…')).toHaveCount(0)
    if (beforeClient) {
      await expect(panel.locator('.wt-layout')).toHaveCount(0)
      await panel.screenshot({ path: `artifacts/worktrees-before/worktrees-${theme}${narrow ? '-narrow' : ''}.png` })
    } else {
      await expect(panel).toHaveScreenshot(`worktrees-${theme}${narrow ? '-narrow' : ''}.png`)
    }
  })
}
