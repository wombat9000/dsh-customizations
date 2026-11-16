import { join } from 'node:path'
import { test, expect, setTheme } from '../../../../tests/real-ui/fixtures.mjs'
import { INTENT, START } from './fixture/index.mjs'

// Generated Dispatch bundle + real DSH shell, transport, agent loops and linked
// worktrees. Only the model route is scripted; no paid provider or credentials.
// The fixture submits six exact assignments: three occupied, three queued.
test.use({ configuredProvider: true })

async function evidence(page, testInfo, name) {
  const path = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path, fullPage: true })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

test('Dispatch pool activity stays visible, truthful and navigable through the native shell', async ({
  app: page,
  context,
}, testInfo) => {
  const repository = join(process.env.DSH_TEST_WORKSPACE, '..', 'dispatch-fixture', 'repository')
  const activity = page.getByLabel(/^Dispatch activity:/u)
  const ready = 'Dispatch activity: 3 occupied, 0 active, 3 queued'
  await test.step('create a coordinator and submit fixture assignments without routine approval cards', async () => {
    await page.getByRole('button', { name: 'Choose workspace' }).click()
    const dialog = page.getByRole('dialog', { name: 'Select Workspace Directory' })
    await dialog.getByRole('button', { name: 'Edit path' }).click()
    await dialog.getByRole('textbox').fill(repository)
    await dialog.getByRole('textbox').press('Enter')
    await dialog.getByRole('button', { name: 'Open' }).click()
    const mode = page.getByRole('menuitem', { name: /^Dispatch\s*Coordinate/u })
    const selected = page.getByRole('button', { name: 'Dispatch', exact: true })
    await expect(async () => {
      if (await selected.isVisible()) return
      if (!(await mode.isVisible()))
        await page.getByRole('button', { name: 'Standard mode' }).click()
      await mode.click({ timeout: 2000 })
      await expect(selected).toBeVisible({ timeout: 2000 })
    }).toPass({ timeout: 30000 })
    // The additive native utility must preserve the host's own controls.
    await expect(
      page.getByRole('button', { name: 'New session', exact: true }).first(),
    ).toBeVisible()
    await page.getByRole('textbox', { name: /Describe what you want/u }).fill(START)
    await page.getByRole('button', { name: 'Send message' }).click()
    await expect(page.getByText('Worker report received.').first()).toBeVisible({ timeout: 30000 })
    await expect(activity).toHaveAttribute('aria-label', ready, { timeout: 30000 })
    await expect(activity).toContainText('waiting')
    await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0)
  })

  const coordinatorRow = page.getByRole('treeitem', { name: 'Dispatch fixture' })
  await test.step('counts survive collapsed history and reload, with accessible native worker navigation', async () => {
    await expect(page.getByRole('button', { name: /^Completed in/u }).first()).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await expect(activity).toBeInViewport()
    await activity.focus()
    await expect(activity).toBeFocused()
    await activity.press('Enter')
    await expect(page.getByRole('banner')).toContainText('Dispatch Worker')
    await expect(page.getByText('Reported to the coordinator.')).toBeVisible()
    await expect(activity).toHaveCount(0) // Worker sessions never show the coordinator’s pool.
    await coordinatorRow.click()
    await expect(activity).toHaveAttribute('aria-label', ready)
    await page.reload()
    await expect(activity).toHaveAttribute('aria-label', ready, { timeout: 30000 })
    await expect(
      coordinatorRow.getByRole('img', { name: 'Dispatch coordinator', exact: true }),
    ).toBeAttached()
    await expect(
      page.getByRole('treeitem').filter({ has: page.getByText(`${INTENT} 1`, { exact: true }) }),
    ).toBeVisible()
  })

  try {
    await test.step('real shell light and narrow dark layouts retain the pill and native controls', async () => {
      await setTheme(page, 'light')
      await expect(activity).toHaveAttribute('aria-label', ready)
      await evidence(page, testInfo, 'dispatch-pool-light')
      await setTheme(page, 'dark')
      await page.setViewportSize({ width: 640, height: 850 })
      await expect(activity).toBeInViewport()
      const bounds = await activity.boundingBox()
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(640)
      await evidence(page, testInfo, 'dispatch-pool-dark-narrow')
    })
    await test.step('connection loss shows unavailable, not false zero or retained live counts', async () => {
      await context.setOffline(true)
      await expect(activity).toHaveAttribute('aria-label', 'Dispatch activity: unavailable', {
        timeout: 15000,
      })
      await expect(activity).not.toContainText('3 occupied')
      await context.setOffline(false)
      await expect(activity).toHaveAttribute('aria-label', ready, { timeout: 30000 })
    })
  } finally {
    if (!page.isClosed()) {
      await context.setOffline(false)
      await page.setViewportSize({ width: 1100, height: 850 })
      await setTheme(page, 'light')
    }
  }
})
