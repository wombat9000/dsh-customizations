import { test, expect, setTheme, expandTurnProcesses } from '../../../../tests/real-ui/fixtures.mjs'
import {
  githubItemsWorkspace,
  githubItemsPrompt,
} from '../../../../tests/real-ui/github-items-fixture.mjs'
import {
  githubFieldWorkspaceName,
  githubFieldPrompt,
} from '../../../../tests/real-ui/github-field-fixture.mjs'

async function openHistory(app, workspace, prompt) {
  const sessions = app.getByRole('tree', { name: 'Sessions', exact: true })
  const group = sessions.getByRole('treeitem', { name: 'Ungrouped', exact: true })
  if ((await group.getAttribute('aria-expanded')) !== 'true') await group.click()
  await sessions.getByRole('treeitem', { name: new RegExp(`^${workspace}\\s`) }).click()
  await expect(app.getByText(prompt, { exact: true })).toBeVisible()
  await expandTurnProcesses(app)
}

async function capture(card, testInfo, name, attachment) {
  const app = card.page()
  const bounds = await card.boundingBox()
  await app.setViewportSize({ width: 1100, height: Math.ceil(bounds.height) + 600 })
  await card.scrollIntoViewIfNeeded()
  const fitted = await card.boundingBox()
  expect(fitted.y).toBeGreaterThanOrEqual(0)
  expect(fitted.y + fitted.height).toBeLessThanOrEqual(app.viewportSize().height)
  const path = testInfo.outputPath(`${name}.png`)
  await card.screenshot({ path })
  await testInfo.attach(attachment, { path, contentType: 'image/png' })
}

async function reviewIssue(app, testInfo, title, theme, narrow) {
  const card = app.getByRole('region', { name: `GitHub ${title}`, exact: true })
  await expect(card).toBeVisible()
  await card.evaluate((node, narrow) => {
    node.style.width = narrow ? '320px' : ''
    node.style.maxWidth = narrow ? '100%' : ''
  }, narrow)
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
  await capture(
    card,
    testInfo,
    `issues-${title.replaceAll(' ', '-')}-${theme}${narrow ? '-narrow' : ''}`,
    'Issue snapshot diagnostic (not baseline)',
  )
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
    // The next theme checkpoint must start with the same collapsed preview.
    await description.press('Enter')
  }
  const raw = card.locator('summary').filter({ hasText: /^Raw tool details$/ })
  await raw.focus()
  await raw.press('Enter')
  await expect(raw.locator('..')).toHaveAttribute('open', '')
  await expect(raw.locator('..').locator('pre')).toContainText('ISSUE_SHELL_INTERNAL')
  await raw.press('Enter')
}

async function reviewItems(app, testInfo, theme, narrow) {
  const card = app.getByRole('region', { name: 'GitHub Project items', exact: true })
  await expect(card).toBeVisible()
  await card.evaluate((node, narrow) => {
    node.style.width = narrow ? '320px' : ''
    node.style.maxWidth = narrow ? '100%' : ''
  }, narrow)
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
  await capture(card, testInfo, `project-items-${theme}${narrow ? '-narrow' : ''}`, 'compact-items')
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
  await raw.press('Enter')
  await technical.focus()
  await technical.press('Enter')
  await fields.focus()
  await fields.press('Enter')
}

async function reviewPullRequests(app) {
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
    await test.step(title, async () => {
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
    })
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
}

async function reviewFields(app, testInfo, theme) {
  const cards = app.getByRole('region', { name: 'GitHub project field change', exact: true })
  await expect(cards).toHaveCount(2)
  const neutral = cards.filter({
    has: app.getByRole('status', { name: '' }).filter({ hasText: 'No change needed' }),
  })
  const failed = cards.filter({ hasText: 'Field change failed' })
  await expect(neutral.getByRole('status')).toHaveText('No change needed')
  await expect(
    neutral.getByText('The field already has the requested value. Nothing was changed.', {
      exact: true,
    }),
  ).toBeVisible()
  await expect(failed.getByRole('alert')).toHaveText('The requested project or item was not found.')
  for (const [index, card] of [neutral, failed].entries()) {
    await card.evaluate((element) => {
      element.style.width = '320px'
      element.style.maxWidth = '100%'
    })
    await expect(
      card.getByText(/Requested target \(call arguments, not verified resource metadata\)/),
    ).toBeVisible()
    await expect(card.getByText(/unavailable/)).toHaveCount(0)
    await expect(card.locator('[aria-label="Prepared before and after values"]')).toHaveCount(0)
    const details = card
      .locator('details')
      .filter({ has: app.locator('summary').filter({ hasText: /^Technical details$/ }) })
    await expect(details).not.toHaveAttribute('open')
    await details.locator('summary').focus()
    await details.locator('summary').press('Enter')
    await expect(details).toHaveAttribute('open', '')
    await expect(details.locator('pre')).toContainText('OPT_TODO')
    await expect(details.getByRole('button', { name: 'Inspect tool call' })).toBeVisible()
    await details.locator('summary').press('Enter')
    expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true,
    )
    await app.evaluate(() => document.fonts.ready)
    const path = testInfo.outputPath(`field-${index}-${theme}-narrow.png`)
    await card.screenshot({ path })
    await testInfo.attach(`field-${index}-${theme}-narrow`, { path, contentType: 'image/png' })
  }
}

test('review historical GitHub cards across themes and compact layouts', async ({
  app,
}, testInfo) => {
  let requests = 0
  const historicalOnly = (route) => {
    requests++
    return route.abort()
  }
  await app.route('**/api/plugins/github/*', historicalOnly)
  try {
    await setTheme(app, 'light', true)
    await openHistory(app, githubItemsWorkspace, githubItemsPrompt)
    for (const [theme, narrow] of [
      ['light', false],
      ['dark', false],
      ['light', true],
      ['dark', true],
    ]) {
      await test.step(`${theme}${narrow ? ' narrow' : ' wide'} historical cards`, async () => {
        await app.setViewportSize({ width: 1100, height: 850 })
        await setTheme(app, theme)
        for (const title of ['Issues', 'Issue search', 'Issue details']) {
          await test.step(title, () => reviewIssue(app, testInfo, title, theme, narrow))
        }
        await test.step('Project items', () => reviewItems(app, testInfo, theme, narrow))
        if (!narrow)
          await test.step('All twelve PR tool views at narrow width', () => reviewPullRequests(app))
        expect(requests).toBe(0)
      })
    }
  } finally {
    // Historical read cards must not refresh; field-result cards below instead
    // exercise the real expired status bridge and native Inspect affordance.
    await app.unroute('**/api/plugins/github/*', historicalOnly)
  }
  await test.step('Historical field no-change and failure results', async () => {
    await app.setViewportSize({ width: 1100, height: 850 })
    for (const theme of ['light', 'dark']) {
      await test.step(`${theme} narrow field results`, async () => {
        // Remount the native session surface after changing the host theme. Its
        // scoped styles can otherwise retain the previous conversation theme.
        await app.getByRole('button', { name: 'Plugins', exact: true }).click()
        await setTheme(app, theme)
        await openHistory(app, githubFieldWorkspaceName, githubFieldPrompt)
        await reviewFields(app, testInfo, theme)
      })
    }
  })
})
