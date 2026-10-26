import {
  test,
  expect,
  openSeededSession,
  setTheme,
  closeGetStarted,
} from '../../../../tests/real-ui/fixtures.mjs'
import { environmentCIWorkspace, worktreeStartupWorkspace } from './ci-fixture.mjs'

const toggle = (app) => app.getByRole('switch', { name: 'Worktree mode', exact: true })
async function openRepository(app, assertEnabled = true) {
  await openSeededSession(app)
  await app
    .getByRole('tree', { name: 'Sessions', exact: true })
    .getByRole('treeitem', { name: new RegExp(`^${environmentCIWorkspace}\\s`) })
    .click()
  if (assertEnabled) {
    await expect(toggle(app)).toBeEnabled()
    const status = await fixture(app)
    expect(status.status.available, JSON.stringify(status)).toBe(true)
  }
}
async function fixture(app, action = 'observe') {
  return app.evaluate(async (body) => {
    const response = await fetch('/api/test/worktree-preference', {
      method: 'POST',
      headers: { 'x-dsh-test': '1' },
      body,
    })
    if (!response.ok) throw new Error(`Fixture ${response.status}: ${await response.text()}`)
    return response.json()
  }, action)
}

test('choose Worktree mode before starting, retain it, and follow native directory changes', async ({
  app,
}, testInfo) => {
  test.setTimeout(60000)
  try {
    await test.step('Native session toolbar disables non-Git folders and saves an advisory preference', async () => {
      await openSeededSession(app)
      await expect(toggle(app)).toBeDisabled()
      await expect(app.locator('[data-worktree-toggle="composer"]')).toHaveAttribute(
        'title',
        /not a Git repository/,
      )
      await openRepository(app)
      await expect(toggle(app)).toHaveAttribute('aria-checked', 'false')
      const before = await fixture(app)
      expect(before.nativeToolAvailable).toBe(true)
      expect(before.guidance).toBe('')
      await toggle(app).click()
      await expect(toggle(app)).toHaveAttribute('aria-checked', 'true')
      const after = await fixture(app)
      expect(after.status.cwd).toBe(before.status.cwd)
      expect(after.guidance).toContain('create_worktree')
      expect(after.guidance).toContain('current HEAD')
      expect(after.guidance).toContain('uncommitted')
      await app.reload()
      await openRepository(app)
      await expect(toggle(app)).toHaveAttribute('aria-checked', 'true')
    })
    await test.step('The initial native repository row exposes the remembered choice without submitting a prompt', async () => {
      await fixture(app, 'startup')
      await app.getByRole('button', { name: 'New session', exact: true }).first().click()
      await closeGetStarted(app)
      await app.getByRole('button', { name: 'Choose workspace', exact: true }).click()
      await app.getByRole('menuitem', { name: worktreeStartupWorkspace, exact: true }).click()
      const hero = app.locator('[data-worktree-toggle="hero"]')
      await expect(hero).toBeVisible()
      await expect(toggle(app)).toHaveAttribute('aria-checked', 'true')
      await expect(app.locator('[data-worktree-toggle="composer"]')).toHaveCount(0)
      await setTheme(app, 'dark')
      const screenshot = testInfo.outputPath('worktree-new-session.png')
      await app.screenshot({ path: screenshot })
      await testInfo.attach(
        'Worktree preference in the native new-session row (disposable shell)',
        { path: screenshot, contentType: 'image/png' },
      )
      // A new session can change its choice without changing the saved parent.
      await toggle(app).click()
      await expect(toggle(app)).toHaveAttribute('aria-checked', 'false')
    })
    await test.step('Environment follows native cwd changes and Off leaves the worktree intact', async () => {
      await openRepository(app)
      const changed = await fixture(app, 'enter')
      expect(changed.status.cwd).toMatch(/worktree-preference$/)
      const card = app.getByRole('region', { name: 'Session environment', exact: true })
      await expect(
        card.getByRole('button', { name: /^Copy CWD: .*worktree-preference$/ }),
      ).toBeVisible()
      await expect(
        card.getByRole('button', {
          name: 'Copy branch name: worktree-preference',
          exact: true,
        }),
      ).toBeVisible()
      await expect(toggle(app)).toBeEnabled()
      await toggle(app).click()
      await expect(toggle(app)).toHaveAttribute('aria-checked', 'false')
      const off = await fixture(app)
      expect(off.status.cwd).toBe(changed.status.cwd)
      expect(off.guidance).toBe('')
      await setTheme(app, 'dark')
      const screenshot = testInfo.outputPath('worktree-active-directory.png')
      await app.screenshot({ path: screenshot })
      await testInfo.attach('Worktree retained after Off (native directory service, fixture Git)', {
        path: screenshot,
        contentType: 'image/png',
      })
      await app.setViewportSize({ width: 640, height: 850 })
      await expect(toggle(app)).toBeVisible()
      const bounds = await toggle(app).boundingBox()
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(640)
    })
  } finally {
    await app.setViewportSize({ width: 1100, height: 850 })
    await openRepository(app, false)
    if (
      (await toggle(app).getAttribute('aria-checked')) === 'true' &&
      (await toggle(app).isEnabled())
    ) {
      await toggle(app).click()
      await expect(toggle(app)).toHaveAttribute('aria-checked', 'false')
    }
    await fixture(app, 'leave')
    await setTheme(app, 'light')
  }
})
