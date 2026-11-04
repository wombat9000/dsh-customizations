import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  test,
  expect,
  openSeededSession,
  setTheme,
  dismissOnboarding,
} from '../../../../tests/real-ui/fixtures.mjs'
import {
  workspaceName,
  prompt,
  replies,
} from '../../../../tests/real-ui/suggest-replies-fixture.mjs'

async function fixtureAction(app, action) {
  const status = await app.evaluate(
    async (action) =>
      (
        await fetch('/api/test/suggest-replies', {
          method: 'POST',
          headers: { 'x-dsh-test': '1', 'x-dsh-action': action },
        })
      ).status,
    action,
  )
  expect(status).toBe(200)
}

test.afterEach(async ({ app }) => fixtureAction(app, 'archive'))

test('native reply dock composes persistent drafts and sends individual replies without consuming the draft', async ({
  app,
}, testInfo) => {
  const requests = []
  let release
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
        result: { ok: true, value: { accepted: true } },
      },
    })
  }
  // Intercept native admission before the Host, as in the Ship it journey:
  // generated client, session binding and RPC are real; no provider can run.
  await app.route('**/api/session/prompt', promptRoute)
  await fixtureAction(app, 'seed')
  await app.reload()
  await dismissOnboarding(app, { previewAcknowledged: true })
  const sessions = app.getByRole('tree', { name: 'Sessions', exact: true })
  const openReplies = async () => {
    const group = sessions.getByRole('treeitem', {
      name: /^Ungrouped(?: New session in Ungrouped)?$/,
    })
    if ((await group.count()) && (await group.getAttribute('aria-expanded')) === 'false')
      await group.click()
    const row = sessions.getByRole('treeitem', { name: new RegExp(`^${workspaceName}\\s`) })
    if (!(await row.count())) {
      const more = sessions.getByRole('button', { name: /^Show \d+ more sessions$/ })
      if (await more.count()) await more.click()
    }
    await row.click()
    await expect(app.getByText(prompt, { exact: true })).toBeVisible()
  }
  const dock = app.getByRole('group', { name: 'Suggested replies', exact: true })
  const editor = app.locator('[contenteditable="true"][role="textbox"]')
  const toggle = (reply) => dock.getByRole('button', { name: reply, exact: true })
  const sendNow = (reply) => dock.getByRole('button', { name: `Send now: ${reply}`, exact: true })
  // Native text projection uses one newline between paragraph blocks. Browser
  // innerText adds two after restored <p> nodes; compare semantic line boundaries.
  const expectDraft = (text) =>
    expect
      .poll(() =>
        editor.evaluate((node) => Array.from(node.children, (block) => block.innerText).join('\n')),
      )
      .toBe(text)
  const capture = async (name) => {
    expect(await dock.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
    const path = testInfo.outputPath(name)
    await app.screenshot({ path })
    await testInfo.attach(name, { path, contentType: 'image/png' })
    if (process.env.DSH_REPLY_CAPTURE_DIR) {
      await mkdir(resolve(process.env.DSH_REPLY_CAPTURE_DIR), { recursive: true })
      const box = await dock.boundingBox()
      const viewport = app.viewportSize()
      const x = Math.max(0, box.x - 20)
      const y = Math.max(0, box.y - 16)
      await app.screenshot({
        path: resolve(process.env.DSH_REPLY_CAPTURE_DIR, name),
        clip: {
          x,
          y,
          width: Math.min(viewport.width - x, box.width + 40),
          height: viewport.height - y,
        },
      })
    }
  }
  const ownDraft = 'Keep my own draft'
  const composedDraft = `${ownDraft}\n${replies[1]}\n${replies[0]}`
  try {
    await openReplies()
    for (const reply of replies) {
      await expect(toggle(reply)).toHaveAttribute('aria-pressed', 'false')
      await expect(sendNow(reply)).toBeVisible()
    }
    await expect(
      app.getByText('Suggested replies are ready. Choose one below to start an editable draft.', {
        exact: true,
      }),
    ).toBeVisible()
    await capture('suggested-replies-light.png')
    await test.step('Keyboard and pointer choices append to the native draft without hiding the dock', async () => {
      await editor.fill(ownDraft)
      await expect(dock).toBeVisible()
      await toggle(replies[1]).focus()
      await app.keyboard.press('Enter')
      await expectDraft(`${ownDraft}\n${replies[1]}`)
      await expect(toggle(replies[1])).toHaveAttribute('aria-pressed', 'true')
      await toggle(replies[0]).click()
      await expectDraft(composedDraft)
      await expect(toggle(replies[0])).toHaveAttribute('aria-pressed', 'true')
      await expect(toggle(replies[1])).toHaveAttribute('aria-pressed', 'true')
      expect(requests).toHaveLength(0)
      await capture('suggested-replies-multiselected-draft.png')
    })
    await test.step('Selected suggestions fit the inherited dark and narrow shell layouts', async () => {
      await setTheme(app, 'dark')
      await expect(dock).toBeVisible()
      await capture('suggested-replies-dark.png')
      await app.setViewportSize({ width: 480, height: 850 })
      await expect(dock).toBeVisible()
      await capture('suggested-replies-narrow.png')
      await app.setViewportSize({ width: 1100, height: 850 })
      await setTheme(app, 'light')
    })
    await test.step('Native draft persistence restores the composed text without requiring selection persistence', async () => {
      await app.reload()
      await expect(app.getByRole('button', { name: 'Account menu', exact: true })).toBeVisible()
      await openReplies()
      await expectDraft(composedDraft)
      await expect(dock).toBeVisible()
      expect(requests).toHaveLength(0)
    })
    await test.step('Holding a suggestion sends only that reply through native admission and preserves the draft', async () => {
      const accepted = app.waitForResponse('**/api/session/prompt')
      await toggle(replies[2]).hover()
      await app.mouse.down()
      // The component suite owns exact hold timing and cancellation edges.
      // Here the held pointer crosses the 700ms threshold on the real shell.
      await expect.poll(() => requests.length).toBe(1)
      await app.mouse.up()
      expect(requests[0]).toMatchObject({
        sessionId: 'visual-test-suggest-replies',
        mode: 'queue',
        content: [{ type: 'text', text: replies[2] }],
      })
      await expectDraft(composedDraft)
      await expect(sendNow(replies[0])).toBeDisabled()
      await openSeededSession(app)
      await openReplies()
      await expect(sendNow(replies[0])).toBeDisabled()
      release()
      await accepted
      await expect(dock.getByRole('status')).toHaveText(
        'Reply sent. Waiting for the conversation to update.',
      )
      await expect(sendNow(replies[0])).toBeDisabled()
      await expectDraft(composedDraft)
    })
    await test.step('The separate Send now action is keyboard accessible and also preserves the draft', async () => {
      // Prompt interception deliberately produces no new history. Reload the
      // isolated client to exercise the alternative action with a fresh latch.
      await app.reload()
      await expect(app.getByRole('button', { name: 'Account menu', exact: true })).toBeVisible()
      await openReplies()
      const accepted = app.waitForResponse('**/api/session/prompt')
      await sendNow(replies[0]).focus()
      await app.keyboard.press('Enter')
      await expect.poll(() => requests.length).toBe(2)
      expect(requests[1]).toMatchObject({
        sessionId: 'visual-test-suggest-replies',
        mode: 'queue',
        content: [{ type: 'text', text: replies[0] }],
      })
      await expectDraft(composedDraft)
      release()
      await accepted
      await expect(dock.getByRole('status')).toHaveText(
        'Reply sent. Waiting for the conversation to update.',
      )
      await expect(sendNow(replies[0])).toBeDisabled()
      await expectDraft(composedDraft)
    })
    expect(requests).toHaveLength(2)
  } finally {
    await app.mouse.up()
    release?.()
    await app.unroute('**/api/session/prompt', promptRoute)
    await app.setViewportSize({ width: 1100, height: 850 })
    await setTheme(app, 'light')
  }
  await openSeededSession(app)
  await expect(dock).toHaveCount(0)
  await app.getByRole('button', { name: 'New session', exact: true }).first().click()
  await expect(dock).toHaveCount(0)
})
