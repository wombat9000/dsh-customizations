import { test, expect, pluginSettings } from '../../../../tests/real-ui/fixtures.mjs'
import {
  githubItemsWorkspace,
  githubItemsPrompt,
} from '../../../../tests/real-ui/github-items-fixture.mjs'
for (const [theme, narrow] of [
  ['light', false],
  ['dark', false],
  ['light', true],
  ['dark', true],
]) {
  test(`historical compact project items in real shell ${theme}${narrow ? ' narrow' : ''}`, async ({
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
    await expect(app.getByText(githubItemsPrompt, { exact: true })).toBeVisible()
    const card = app.getByRole('region', { name: 'GitHub Project items', exact: true })
    await expect(card).toBeVisible()
    if (narrow)
      await card.evaluate((node) => {
        node.style.width = '320px'
        node.style.maxWidth = '100%'
      })
    await expect(card.locator('.gh-item')).toHaveCount(6)
    await expect(card.getByText('Issue state: OPEN', { exact: true })).toHaveCount(3)
    await expect(card.getByText('Board status: Done', { exact: true })).toHaveCount(3)
    await expect(
      card.getByRole('link', { name: '#20 — Implement compact rows', exact: true }),
    ).toHaveAttribute('href', 'https://github.com/fixture-org/demo/pull/20')
    await expect(card.getByText('Archived', { exact: true })).toHaveCount(1)
    expect(await card.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
    expect(
      await card
        .locator('.gh-item')
        .evaluateAll((rows) =>
          rows.every((row) => row.querySelectorAll('details[open]').length === 0),
        ),
    ).toBe(true)
    const visible = await card.innerText()
    for (let number = 1; number <= 6; number++)
      expect(visible.split(`Compact project item ${number}`)).toHaveLength(2)
    for (const value of ['PVTI_', 'Board field', 'not archived', 'Value unavailable'])
      expect(visible).not.toContain(value)
    if (!narrow)
      expect(
        await card
          .locator('.gh-item')
          .evaluateAll((rows) =>
            rows.reduce((sum, row) => sum + row.getBoundingClientRect().height, 0),
          ),
      ).toBeLessThan(850)
    // Fit the card inside the conversation viewport before capturing; otherwise
    // the shell's fixed composer and scroll clipping can obscure lower rows.
    const bounds = await card.boundingBox()
    await app.setViewportSize({
      width: app.viewportSize().width,
      height: Math.ceil(bounds.height) + 600,
    })
    await card.scrollIntoViewIfNeeded()
    const fitted = await card.boundingBox()
    expect(fitted.y).toBeGreaterThanOrEqual(0)
    expect(fitted.y + fitted.height).toBeLessThanOrEqual(app.viewportSize().height)
    const path = testInfo.outputPath(`project-items-${theme}${narrow ? '-narrow' : ''}.png`)
    await card.screenshot({ path })
    await testInfo.attach('compact-items', { path, contentType: 'image/png' })
    const first = card.locator('.gh-item').first()
    const fields = first.getByLabel('Additional fields for item #1', { exact: true })
    await fields.focus()
    await fields.press('Enter')
    await expect(first.getByText('Notes: Empty string', { exact: true })).toBeVisible()
    const technical = first.locator('summary').filter({ hasText: /^Technical details$/ })
    await technical.focus()
    await technical.press('Enter')
    await expect(first.locator('pre')).toContainText('PVTI_compact_1')
    const raw = card.locator('summary').filter({ hasText: /^Raw tool details$/ })
    await raw.focus()
    await raw.press('Enter')
    await expect(raw.locator('..').locator('pre')).toContainText('"untrusted":true')
    expect(requests).toBe(0)
  })
}
