import { test, expect, pluginSettings } from '../../../../tests/real-ui/fixtures.mjs'

for (const theme of ['light', 'dark']) {
  test(`real dock follows persisted and blank sessions without calling a provider (${theme})`, async ({ app }) => {
    const settings = await pluginSettings(app, theme)
    const prefix = theme === 'light' ? 'recap' : 'recap-dark'
    await settings.getByRole('button', { name: 'Close', exact: true }).click()
    await app.getByRole('treeitem', { name: 'Ungrouped', exact: true }).click()
    await app.getByRole('treeitem', { name: /^workspace / }).click()
    await expect(app.getByText('Review the Session recap interface.', { exact: true })).toBeVisible()
    const dock = app.getByRole('complementary', { name: 'Session recap' })
    await expect(dock).toHaveCount(0)
    const recap = app.getByRole('button', { name: 'Recap', exact: true })
    await expect(recap).toBeVisible()
    await expect(recap).toHaveScreenshot(`${prefix}-existing-session.png`)
    await recap.click()
    await expect(dock.getByRole('alert')).toHaveText('Choose a provider and model in Settings → Plugins → Session Recap.')
    await expect(dock).toHaveScreenshot(`${prefix}-no-provider.png`)
    await dock.getByRole('button', { name: 'Dismiss session recap' }).click()
    await expect(dock).toHaveCount(0)
    await recap.click()
    await expect(dock.getByRole('alert')).toHaveText('Choose a provider and model in Settings → Plugins → Session Recap.')
    await app.getByRole('button', { name: 'New session', exact: true }).first().click()
    await expect(recap).toHaveCount(0)
    await expect(app.getByRole('complementary', { name: 'Session recap' })).toHaveCount(0)
    await expect(app.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled()
  })
}
