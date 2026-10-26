import {
  test,
  expect,
  openSeededSession,
  setTheme,
  closeGetStarted,
} from '../../../../tests/real-ui/fixtures.mjs'

test.use({ deviceScaleFactor: 2 })

// Independent copy of the user's requested text: do not import the production
// constant as its own expected value. The wire boundary owns this exact contract.
const expectedPrompt =
  "Ship all committed and uncommitted changes to origin/main. Commit any uncommitted changes before pushing. If push fails because origin/main is ahead, rebase and resolve merge conflicts, checking with me before proceeding if there are any substantive conflicts, then push again. If rebasing floods add/add conflicts in unrelated files, run `git rebase --abort`, `git fetch --quiet --unshallow origin`, then rebase again. Fetch origin and rebase onto latest origin/main, then run the full test suite before pushing. Do not repeat it after a later fetch, rebase, or rejected push unless conflict resolution or other local edits changed files after the successful test run. Ignore a failing check from the test suite only after verifying that the same check also fails on origin/main without this thread's changes."

test('Ship it sends the exact instruction to the owning session and preserves the native draft', async ({
  app,
}, testInfo) => {
  const requests = []
  let release
  let fail = false
  const promptRoute = async (route) => {
    const request = route.request().postDataJSON()
    requests.push(request.payload.args.request)
    await new Promise((resolve) => {
      release = resolve
    })
    await route.fulfill({
      json: {
        type: 'server-response',
        rpcId: request.rpcId,
        result: fail
          ? { ok: false, error: { code: 'internal', message: 'Fixture rejection', details: {} } }
          : { ok: true, value: { accepted: true } },
      },
    })
  }
  // Intercept admission before the Host: no model, Git command, or remote push
  // can run. The generated client, native scope binding and RPC are real.
  await app.route('**/api/session/prompt', promptRoute)
  const ship = app.getByRole('button', { name: 'Ship it', exact: true })
  const draft = app.locator('[contenteditable="true"][role="textbox"]')
  try {
    await test.step('Add one header action alongside native controls, in light and narrow dark layouts', async () => {
      await openSeededSession(app)
      await expect(ship).toBeEnabled()
      await expect(ship).toHaveCount(1)
      await expect(
        app.getByRole('button', { name: 'New session', exact: true }).first(),
      ).toBeVisible()
      await draft.fill('Keep this unrelated draft exactly as written.')
      await app.screenshot({ path: testInfo.outputPath('ship-it-light.png') })
      await setTheme(app, 'dark')
      await app.setViewportSize({ width: 640, height: 850 })
      await expect(ship).toBeInViewport()
      const bounds = await ship.boundingBox()
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(640)
      await app.screenshot({ path: testInfo.outputPath('ship-it-dark-narrow.png') })
      await app.setViewportSize({ width: 1100, height: 850 })
      await setTheme(app, 'light')
    })
    await test.step('A click sends only the shipping text, leaves the draft, and locks duplicate admission', async () => {
      await ship.click()
      await expect.poll(() => requests.length).toBe(1)
      await expect(ship).toBeDisabled()
      await expect(ship).toContainText('Sending')
      await expect(draft).toHaveText('Keep this unrelated draft exactly as written.')
      expect(requests[0].sessionId).toBe('visual-test-history')
      expect(requests[0].mode).toBe('queue')
      expect(requests[0].content).toEqual([{ type: 'text', text: expectedPrompt }])
      await app.screenshot({ path: testInfo.outputPath('ship-it-sending.png') })
      release()
      await expect(ship).toBeEnabled()
      await expect(draft).toHaveText('Keep this unrelated draft exactly as written.')
    })
    await test.step('A rejected admission is visible and is never retried automatically', async () => {
      fail = true
      await ship.focus()
      await app.keyboard.press('Enter')
      await expect.poll(() => requests.length).toBe(2)
      release()
      await expect(
        app.getByRole('alert').filter({ hasText: 'Could not confirm the shipping request' }),
      ).toBeVisible()
      await expect(ship).toBeEnabled()
      await expect(draft).toHaveText('Keep this unrelated draft exactly as written.')
      await app.screenshot({ path: testInfo.outputPath('ship-it-error.png') })
      await app.getByRole('button', { name: 'New session', exact: true }).first().click()
      await closeGetStarted(app)
      await expect(ship).toHaveCount(0)
      await expect(
        app.getByText('Could not confirm the shipping request.', { exact: false }),
      ).toHaveCount(0)
      expect(requests).toHaveLength(2)
    })
  } finally {
    release?.()
    await app.unrouteAll({ behavior: 'wait' })
    await app.setViewportSize({ width: 1100, height: 850 })
    await setTheme(app, 'light')
  }
})
