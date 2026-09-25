import { test, expect, pluginSettings } from '../../../../tests/real-ui/fixtures.mjs'
import { githubItemsWorkspace } from '../../../../tests/real-ui/github-items-fixture.mjs'

for (const [theme, narrow] of [
  ['light', false],
  ['dark', false],
  ['light', true],
  ['dark', true],
]) {
  test(`compact issue snapshots in real shell ${theme}${narrow ? ' narrow' : ''}`, async ({
    app,
  }, testInfo) => {
    let requests = 0
    await app.route('**/api/plugins/github/*', (route) => {
      requests++
      return route.abort()
    })
    const settings = await pluginSettings(app, theme)
    await settings.getByRole('button', { name: 'Close', exact: true }).click()
    const sessions = app.getByRole('tree', { name: 'Sessions', exact: true })
    const group = sessions.getByRole('treeitem', { name: 'Ungrouped', exact: true })
    if ((await group.getAttribute('aria-expanded')) !== 'true') await group.click()
    await sessions
      .getByRole('treeitem', { name: new RegExp(`^${githubItemsWorkspace}\\s`) })
      .click()
    for (const title of ['Issues', 'Issue search', 'Issue details']) {
      const card = app.getByRole('region', { name: `GitHub ${title}`, exact: true })
      await expect(card).toBeVisible()
      if (narrow)
        await card.evaluate((node) => {
          node.style.width = '320px'
          node.style.maxWidth = '100%'
        })
      await expect(card.getByLabel('Issue state: Open', { exact: true }).first()).toBeVisible()
      const link = card.getByRole('link', { name: /#59 — Compact issue shell fixture/ }).first()
      await link.focus()
      await expect(link).toBeFocused()
      await expect(link).toHaveAttribute('href', 'https://github.com/fixture-org/demo/issues/59')
      expect(await card.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
      const visible = await card.innerText()
      expect(visible).not.toContain('ISSUE_SHELL_INTERNAL')
      expect(visible).not.toContain('not board Status')
      if (title === 'Issues') expect(visible.split('fixture-org/demo')).toHaveLength(2)
      if (title === 'Issue search') {
        expect(visible).toContain('fixture-org/demo')
        expect(visible).toContain('fixture-org/other')
      }
      if (title === 'Issue details') {
        expect(visible).toContain('Visible description preview.')
        expect(visible).not.toContain('1 entry returned')
        expect(visible).toContain('shell-label')
        expect(visible).toContain('fixture-user')
        expect(visible).toContain('Blocked by')
        expect(visible).not.toContain('END OF SHELL DESCRIPTION')
      }
      const bounds = await card.boundingBox()
      await app.setViewportSize({
        width: app.viewportSize().width,
        height: Math.ceil(bounds.height) + 600,
      })
      await card.scrollIntoViewIfNeeded()
      const path = testInfo.outputPath(
        `issues-${title.replaceAll(' ', '-')}-${theme}${narrow ? '-narrow' : ''}.png`,
      )
      await card.screenshot({ path })
      await testInfo.attach('Issue snapshot diagnostic (not baseline)', {
        path,
        contentType: 'image/png',
      })
      if (title === 'Issue details') {
        const description = card
          .locator('summary')
          .filter({ hasText: /description/i })
          .first()
        await description.focus()
        await description.press('Enter')
        await expect(description.locator('..')).toHaveAttribute('open', '')
        await expect(description.locator('..')).toContainText('END OF SHELL DESCRIPTION')
        expect(await card.locator('script,img,iframe').count()).toBe(0)
      }
      const raw = card.locator('summary').filter({ hasText: /^Raw tool details$/ })
      await raw.focus()
      await raw.press('Enter')
      await expect(raw.locator('..')).toHaveAttribute('open', '')
      await expect(raw.locator('..').locator('pre')).toContainText('ISSUE_SHELL_INTERNAL')
      await raw.press('Enter')
    }
    expect(requests).toBe(0)
  })
}
