import { test, expect, pluginSettings } from '../../../../tests/real-ui/fixtures.mjs'

test('real dock follows persisted and blank sessions without calling a provider', async ({ app }) => {
  const settings = await pluginSettings(app, 'light')
  await settings.getByRole('button', { name: 'Close', exact: true }).click()
  await app.getByRole('treeitem', { name: 'Ungrouped', exact: true }).click()
  await app.getByRole('treeitem', { name: /^workspace / }).click()
  await expect(app.getByText('Review the Session recap interface.', { exact: true })).toBeVisible()
  const dock = app.getByRole('complementary', { name: 'Session recap' })
  await expect(dock).toBeVisible()
  await expect(dock).toHaveScreenshot('recap-existing-session.png')
  await dock.getByRole('button', { name: 'Recap', exact: true }).click()
  await expect(dock.getByRole('alert')).toHaveText('Choose a provider and model in Settings → Plugins → Session Recap.')
  await expect(dock).toHaveScreenshot('recap-no-provider.png')
  await app.getByRole('button', { name: 'New session', exact: true }).first().click()
  await expect(app.getByRole('complementary', { name: 'Session recap' })).toHaveCount(0)
  await expect(app.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled()
})
