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
    await test.step('New sessions use the same composer control without submitting a prompt', async () => {
      await fixture(app, 'startup')
      await app.getByRole('button', { name: 'New session', exact: true }).first().click()
      await closeGetStarted(app)
      await app.getByRole('button', { name: 'Choose workspace', exact: true }).click()
      await app.getByRole('menuitem', { name: worktreeStartupWorkspace, exact: true }).click()
      const composer = app.locator('[data-worktree-toggle="composer"]')
      await expect(composer).toBeVisible()
      await expect(composer).toHaveCount(1)
      await expect(app.locator('[data-worktree-toggle="hero"]')).toHaveCount(0)
      await expect(toggle(app)).toHaveAttribute('aria-checked', 'true')
      await setTheme(app, 'dark')
      const screenshot = testInfo.outputPath('worktree-new-session.png')
      await app.screenshot({ path: screenshot })
      await testInfo.attach(
        'Worktree preference in the new-session composer toolbar (disposable shell)',
        { path: screenshot, contentType: 'image/png' },
      )
      // Hold only the real save response. Native disabled styles and adjacent
      // toolbar controls must not blink or move while the browser awaits it.
      const beforeSave = await toggle(app).boundingBox()
      const opacity = await toggle(app).evaluate((button) => getComputedStyle(button).opacity)
      let release
      const held = new Promise((resolve) => {
        release = resolve
      })
      let responseHeld = false
      let delivery = Promise.resolve()
      const saveEndpoint = '**/api/sessionEnvironment/setWorktreePreference'
      const holdSave = (route) => {
        delivery = (async () => {
          const response = await route.fetch()
          responseHeld = true
          await held
          await route.fulfill({ response })
        })()
        return delivery
      }
      await app.route(saveEndpoint, holdSave)
      try {
        // A new session changes only its choice, not the saved parent's choice.
        await toggle(app).click()
        await expect.poll(() => responseHeld).toBe(true)
        await expect(toggle(app)).toHaveAttribute('aria-busy', 'true')
        await expect(toggle(app)).toBeDisabled()
        await expect(toggle(app)).toHaveAttribute('aria-checked', 'true')
        expect(await toggle(app).boundingBox()).toEqual(beforeSave)
        await expect(toggle(app)).toHaveCSS('opacity', opacity)
        const pendingScreenshot = testInfo.outputPath('worktree-save-pending.png')
        await composer.screenshot({ path: pendingScreenshot })
        await testInfo.attach('Stable Worktree control while the real save response is held', {
          path: pendingScreenshot,
          contentType: 'image/png',
        })
      } finally {
        release()
        await delivery
        await app.unroute(saveEndpoint, holdSave)
      }
      await expect(toggle(app)).toBeEnabled()
      await expect(toggle(app)).toHaveAttribute('aria-checked', 'false')
      expect(await toggle(app).boundingBox()).toEqual(beforeSave)
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
