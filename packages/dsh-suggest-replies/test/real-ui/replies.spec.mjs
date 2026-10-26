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

test('native reply dock restores tool results and fills only an empty draft', async ({
  app,
}, testInfo) => {
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
  await openReplies()
  const dock = app.getByRole('group', { name: 'Suggested replies', exact: true })
  const editor = app.locator('[contenteditable="true"]').first()
  const clearDraft = async () => {
    await editor.press('ControlOrMeta+A')
    await editor.press('Backspace')
    await expect(dock).toBeVisible()
  }
  await expect(dock.getByRole('button')).toHaveText(replies)
  await expect(
    app.getByText('Suggested replies are ready. Choose one below to start an editable draft.', {
      exact: true,
    }),
  ).toBeVisible()
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
  await capture('suggested-replies-light.png')
  await test.step('Keyboard choice fills the composer without sending and survives reload', async () => {
    await dock.getByRole('button', { name: replies[1], exact: true }).focus()
    await app.keyboard.press('Enter')
    await expect(editor).toHaveText(replies[1])
    await expect(dock).toHaveCount(0)
    await expect(app.getByText(prompt, { exact: true })).toHaveCount(1)
    await app.reload()
    await expect(app.getByRole('button', { name: 'Account menu', exact: true })).toBeVisible()
    await openReplies()
    await expect(editor).toHaveText(replies[1])
    await expect(dock).toHaveCount(0)
    await editor.press('ControlOrMeta+A')
    await editor.pressSequentially('Keep my own draft')
    await expect(editor).toHaveText('Keep my own draft')
    await expect(dock).toHaveCount(0)
    await clearDraft()
    await dock.getByRole('button', { name: replies[0], exact: true }).click()
    await expect(editor).toHaveText(replies[0])
    await clearDraft()
  })
  try {
    await setTheme(app, 'dark')
    await openReplies()
    await expect(dock).toBeVisible()
    await capture('suggested-replies-dark.png')
    await app.setViewportSize({ width: 480, height: 850 })
    await expect(dock).toBeVisible()
    await capture('suggested-replies-narrow.png')
  } finally {
    await app.setViewportSize({ width: 1100, height: 850 })
    await setTheme(app, 'light')
  }
  await openSeededSession(app)
  await expect(dock).toHaveCount(0)
  await app.getByRole('button', { name: 'New session', exact: true }).first().click()
  await expect(dock).toHaveCount(0)
})
