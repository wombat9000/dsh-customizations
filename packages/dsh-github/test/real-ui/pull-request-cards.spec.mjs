import { test, expect, setTheme, expandTurnProcesses } from '../../../../tests/real-ui/fixtures.mjs'
import { githubItemsWorkspace } from '../../../../tests/real-ui/github-items-fixture.mjs'

for (const theme of ['light', 'dark']) {
  test(`PR interactions mount in the real shell with concise narrow cards (${theme})`, async ({
    app,
  }) => {
    let requests = 0
    await app.route('**/api/plugins/github/*', (route) => {
      requests++
      return route.abort()
    })
    await setTheme(app, theme, true)
    const sessions = app.getByRole('tree', { name: 'Sessions', exact: true })
    const group = sessions.getByRole('treeitem', { name: 'Ungrouped', exact: true })
    if ((await group.getAttribute('aria-expanded')) !== 'true') await group.click()
    await sessions
      .getByRole('treeitem', { name: new RegExp(`^${githubItemsWorkspace}\\s`) })
      .click()
    await expandTurnProcesses(app)
    for (const title of [
      'Pull requests',
      'Pull request details',
      'Changed files',
      'Reviews',
      'Review threads',
      'Checks',
      'Stack details',
      'Create draft pull request',
      'Update pull request',
      'Submit review',
      'Create stack',
      'Append to stack',
    ]) {
      const card = app.getByRole('region', { name: `GitHub ${title}`, exact: true })
      await expect(card).toBeVisible()
      await card.evaluate((node) => {
        node.style.width = '320px'
        node.style.maxWidth = '100%'
      })
      expect(await card.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
      const raw = card.locator('summary').filter({ hasText: /^Raw tool details$/ })
      await raw.focus()
      await raw.press('Enter')
      await expect(raw.locator('..')).toHaveAttribute('open', '')
      await expect(raw.locator('..').locator('pre')).toContainText('github.com')
      await raw.press('Enter')
      expect(await card.locator('script,img,iframe').count()).toBe(0)
    }
    await expect(
      app.getByRole('region', { name: 'GitHub Submit review', exact: true }),
    ).toContainText('APPROVED')
    await expect(
      app.getByRole('region', { name: 'GitHub Submit review', exact: true }),
    ).not.toContainText('Ready for review')
    await expect(
      app.getByRole('region', { name: 'GitHub Review threads', exact: true }),
    ).toContainText('not complete')
    expect(requests).toBe(0)
  })
}
