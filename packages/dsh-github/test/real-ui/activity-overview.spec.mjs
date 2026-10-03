import {
  test,
  expect,
  expandTurnProcesses,
  openSeededSession,
} from '../../../../tests/real-ui/fixtures.mjs'
import {
  githubItemsWorkspace,
  githubItemsPrompt,
} from '../../../../tests/real-ui/github-items-fixture.mjs'

test('historical GitHub turn tail remains visible outside native collapsed work', async ({
  app,
}, testInfo) => {
  let requests = 0
  const noGithubRequests = (route) => {
    requests++
    return route.abort()
  }
  await app.route('**/api/plugins/github/*', noGithubRequests)
  try {
    await test.step('Mount one overview on the owning closed turn without opening work', async () => {
      const sessions = app.getByRole('tree', { name: 'Sessions', exact: true })
      const group = sessions.getByRole('treeitem', { name: 'Ungrouped', exact: true })
      if ((await group.getAttribute('aria-expanded')) !== 'true') await group.click()
      await sessions
        .getByRole('treeitem', { name: new RegExp(`^${githubItemsWorkspace}\\s`) })
        .click()
      await expect(app.getByText(githubItemsPrompt, { exact: true })).toBeVisible()
      const work = app.locator('[data-turn-process]').first()
      await expect(work).toHaveAttribute('aria-expanded', 'false')
      const overview = app.getByRole('region', { name: 'GitHub activity overview', exact: true })
      await expect(overview).toHaveCount(1)
      await expect(overview).toBeVisible()
      await expect(
        app
          .locator('[data-turn-tail="1"]')
          .getByRole('region', { name: 'GitHub activity overview', exact: true }),
      ).toBeVisible()
      await expect(overview).toContainText('confirmed writes')
      await expect(overview).toContainText('read-only inspections')
      await expect(
        app.getByRole('region', { name: 'GitHub Pull request details', exact: true }),
      ).not.toBeVisible()
      expect(await overview.evaluate((node) => node.closest('[data-process-activity]'))).toBeNull()
      // Fit the collapsed turn and its tail in the real shell, without hiding
      // native overlays or changing application markup for the capture.
      await app.setViewportSize({ width: 1100, height: 1100 })
      await overview.scrollIntoViewIfNeeded()
      expect(await overview.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
      await expect(overview.getByText(/Confirmed.*Write:/).first()).toBeVisible()
      const path = testInfo.outputPath('github-activity-compact.png')
      await app.screenshot({ path })
      await testInfo.attach(
        'GitHub activity diagnostic: disposable shell, fixture history, not baseline',
        { path, contentType: 'image/png' },
      )
      expect(requests).toBe(0)
    })
    await test.step('Native per-tool cards still render independently when work opens', async () => {
      await expandTurnProcesses(app)
      await expect(
        app.getByRole('region', { name: 'GitHub Pull request details', exact: true }),
      ).toBeVisible()
      await expect(
        app.getByRole('region', { name: 'GitHub activity overview', exact: true }),
      ).toHaveCount(1)
      expect(requests).toBe(0)
    })
    await test.step('Another historical session and a blank session have no GitHub overview', async () => {
      await openSeededSession(app)
      await expect(
        app.getByRole('region', { name: 'GitHub activity overview', exact: true }),
      ).toHaveCount(0)
      await app.getByRole('button', { name: 'New session', exact: true }).first().click()
      await expect(
        app.getByRole('region', { name: 'GitHub activity overview', exact: true }),
      ).toHaveCount(0)
      expect(requests).toBe(0)
    })
  } finally {
    await app.unroute('**/api/plugins/github/*', noGithubRequests)
  }
})
