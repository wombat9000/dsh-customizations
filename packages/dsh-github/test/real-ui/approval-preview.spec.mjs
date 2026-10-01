import { test, expect, setTheme, expandTurnProcesses } from '../../../../tests/real-ui/fixtures.mjs'
import {
  githubWorkspaceName,
  githubPrompt,
} from '../../../../tests/real-ui/github-grants-fixture.mjs'
import { approvalNames } from '../approval-preview-fixtures.js'
import {
  commandWorkspace,
  commandText,
} from '../../../../tests/real-ui/github-approval-fixture.mjs'
async function action(page, action, operation) {
  return page.evaluate(
    async (input) => {
      const response = await fetch('/api/test/github-approval', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dsh-test': '1' },
        body: JSON.stringify(input),
      })
      if (!response.ok) throw new Error(`Synthetic fixture ${response.status}`)
      return response.json()
    },
    { action, operation },
  )
}
test.afterEach(async ({ app }) => {
  await action(app, 'cancel').catch(() => {})
})
async function openSession(page, theme) {
  await setTheme(page, theme)
  const sessions = page.getByRole('tree', { name: 'Sessions', exact: true }),
    group = sessions.getByRole('treeitem', { name: 'Ungrouped', exact: true })
  if ((await group.getAttribute('aria-expanded')) !== 'true') await group.click()
  await sessions.getByRole('treeitem', { name: new RegExp(`^${githubWorkspaceName}\\s`) }).click()
  await expect(page.getByText(githubPrompt, { exact: true })).toBeVisible()
  await expandTurnProcesses(page)
  await expect(
    page.getByRole('region', { name: 'GitHub issue management grant', exact: true }),
  ).toBeVisible()
  await expect.poll(async () => (await action(page, 'state')).ready).toBe(true)
}
async function reviewIssueApproval(app, testInfo, theme, narrow) {
  await openSession(app, theme)
  const started = await action(app, 'start', 'createIssue')
  const card = app.getByRole('region', { name: 'GitHub approval preview', exact: true })
  await expect(card).toBeVisible()
  const native = app.locator('[data-approval-key]')
  await expect(native.getByRole('button')).toHaveCount(2)
  await expect(native.locator('[data-approval-scroll] > div').first()).toBeHidden()
  if (narrow)
    await native.evaluate((node) => {
      node.style.width = '320px'
      node.style.maxWidth = '100%'
    })
  expect(await card.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
  const collapsedPath = testInfo.outputPath(
    `native-approval-default-${theme}${narrow ? '-narrow' : ''}.png`,
  )
  await native.screenshot({ path: collapsedPath })
  await testInfo.attach('Default readable native approval', {
    path: collapsedPath,
    contentType: 'image/png',
  })
  const source = card
    .locator('summary')
    .filter({ hasText: 'Proposed issue body: exact source and whitespace' })
  await source.focus()
  await expect(source).toBeFocused()
  await source.press('Enter')
  expect((await action(app, 'state')).outcome).toBe('pending')
  await expect(source.locator('..').locator('pre').first()).toContainText('END OF COMPLETE BODY')
  const details = card
    .locator('summary')
    .filter({ hasText: 'Technical details — complete exact approval payload' })
  await details.focus()
  await details.press('Enter')
  await expect(details.locator('..')).toHaveAttribute('open', '')
  await expect(details.locator('..').locator('pre')).toHaveText(started.reason)
  expect(await card.locator('script,img,iframe').count()).toBe(0)
  const path = testInfo.outputPath(`native-approval-${theme}${narrow ? '-narrow' : ''}.png`)
  await native.screenshot({ path })
  await testInfo.attach('Native approval diagnostic (not baseline)', {
    path,
    contentType: 'image/png',
  })
  // Exercise the unchanged native first button (Reject) by keyboard.
  const reject = native.getByRole('button').first()
  await reject.focus()
  await reject.press('Enter')
  await expect(card).toHaveCount(0)
  await expect.poll(async () => (await action(app, 'state')).outcome).toBe('rejected')
}
async function reviewMembershipApproval(app, testInfo, theme, narrow) {
  await openSession(app, theme)
  const started = await action(app, 'start', 'addProjectItem')
  const card = app.getByRole('region', { name: 'GitHub approval preview', exact: true })
  await expect(card).toBeVisible()
  const native = app.locator('[data-approval-key]')
  if (narrow)
    await native.evaluate((node) => {
      node.style.width = '320px'
      node.style.maxWidth = '100%'
    })
  const resources = card.locator('.gh-approval-resource')
  await expect(resources).toHaveCount(2)
  await expect(resources.nth(0)).toContainText('Destination project')
  await expect(resources.nth(1)).toContainText('Issue to add')
  await expect(resources.nth(0)).toContainText('fixture · #7')
  await expect(resources.nth(1)).toContainText('fixture/repo · #49')
  for (const resource of await resources.all()) {
    const link = resource.getByRole('link')
    await link.focus()
    await expect(link).toBeFocused()
    await expect(link).toContainText('↗')
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  }
  await expect(
    card.locator('summary').filter({ hasText: 'exact source and whitespace' }),
  ).toHaveCount(0)
  await expect(native.getByRole('button')).toHaveCount(2)
  expect(await card.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
  const path = testInfo.outputPath(`membership-resources-${theme}${narrow ? '-narrow' : ''}.png`)
  await native.screenshot({ path })
  await testInfo.attach('Membership resource diagnostic (not baseline)', {
    path,
    contentType: 'image/png',
  })
  const details = card
    .locator('summary')
    .filter({ hasText: 'Technical details — complete exact approval payload' })
  await details.focus()
  await details.press('Enter')
  await expect(details.locator('..')).toHaveAttribute('open', '')
  await expect(details.locator('..').locator('pre')).toHaveText(started.reason)
  await native.getByRole('button').first().click()
  await expect.poll(async () => (await action(app, 'state')).outcome).toBe('rejected')
}
async function reviewCommandFallback(app) {
  await openSession(app, 'light')
  await app
    .getByRole('tree', { name: 'Sessions', exact: true })
    .getByRole('treeitem', { name: new RegExp(`^${commandWorkspace}\\s`) })
    .click()
  await expect.poll(async () => (await action(app, 'state', 'command')).ready).toBe(true)
  await action(app, 'start', 'command')
  const native = app.locator('[data-approval-key]')
  await expect(native.getByRole('button')).toHaveCount(2)
  await expect(native.locator('[data-approval-scroll]')).toContainText(commandText)
  await expect(native.locator('[data-approval-scroll] > div').first()).toBeVisible()
  await expect(
    app.getByRole('region', { name: 'GitHub approval preview', exact: true }),
  ).toHaveCount(0)
  await native.getByRole('button').first().click()
  await expect.poll(async () => (await action(app, 'state')).outcome).toBe('rejected')
}
async function allowSupportedPreviews(app) {
  await openSession(app, 'light')
  for (const operation of approvalNames) {
    await test.step(`${operation} preview and native Allow once`, async () => {
      await action(app, 'start', operation)
      const card = app.getByRole('region', { name: 'GitHub approval preview', exact: true })
      await expect(card).toBeVisible()
      if (operation === 'addProjectItem')
        await expect(card.getByRole('group', { name: 'Proposed GitHub change' })).not.toContainText(
          'UNRELATED PROJECT README SENTINEL',
        )
      await expect(app.locator('[data-approval-key]').getByRole('button')).toHaveCount(2)
      await app.locator('[data-approval-key]').getByRole('button').last().click()
      await expect(card).toHaveCount(0)
      await expect.poll(async () => (await action(app, 'state')).outcome).toBe('allowed-once')
    })
  }
  const malformed = await action(app, 'start', 'malformed')
  await expect(
    app.getByRole('region', { name: 'GitHub approval preview', exact: true }),
  ).toHaveCount(0)
  await expect(app.locator('[data-approval-scroll]')).toContainText(malformed.reason)
  await expect(app.locator('[data-approval-key]').getByRole('button')).toHaveCount(2)
  await action(app, 'cancel')
  await expect(app.locator('[data-approval-key]')).toHaveCount(0)
}

test('review native GitHub approvals, controls and unrelated fallback', async ({
  app,
}, testInfo) => {
  for (const [theme, narrow] of [
    ['light', false],
    ['dark', false],
    ['dark', true],
  ]) {
    await test.step(`Issue approval ${theme}${narrow ? ' narrow' : ''}`, () =>
      reviewIssueApproval(app, testInfo, theme, narrow))
  }
  for (const [theme, narrow] of [
    ['light', false],
    ['dark', false],
    ['light', true],
    ['dark', true],
  ]) {
    await test.step(`Membership approval ${theme}${narrow ? ' narrow' : ''}`, async () => {
      await reviewMembershipApproval(app, testInfo, theme, narrow)
      await expect(app.locator('[data-approval-key]')).toHaveCount(0)
    })
  }
  await test.step('Unrelated command retains the shipped detail and Reject', () =>
    reviewCommandFallback(app))
  await test.step('All seven registered previews, Allow once and malformed fallback', () =>
    allowSupportedPreviews(app))
})
