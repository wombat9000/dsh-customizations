import { test, expect, pluginSettings } from '../../../../tests/real-ui/fixtures.mjs'

test('Jev selection persists through the real plugin row configuration with no key field', async ({
  app,
}) => {
  const configuration = await pluginSettings(app, 'light')
  const option = configuration.getByLabel('Use Jev to choose recap cards')
  try {
    await expect(option).not.toBeChecked()
    await option.check()
    await configuration.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(configuration.getByText('Session recap settings saved.')).toBeVisible()
    // Reenter through the real package/row route, not a mounted-component mock.
    const reopened = await pluginSettings(app, 'light')
    await expect(reopened.getByLabel('Use Jev to choose recap cards')).toBeChecked()
    await expect(reopened.locator('input[type=password]')).toHaveCount(0)
  } finally {
    await app.getByLabel('Use Jev to choose recap cards').uncheck()
    await app.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(app.getByText('Session recap settings saved.')).toBeVisible()
  }
})

for (const scheme of ['light', 'dark']) {
  test(`real plugin row configuration in ${scheme} mode`, async ({ app }) => {
    // Keep the expanded consent text and Save control visible in the capture.
    await app.setViewportSize({ width: app.viewportSize().width, height: 1100 })
    const configuration = await pluginSettings(app, scheme)
    await expect(configuration.getByLabel('Provider ID')).toHaveValue('')
    await expect(configuration.getByLabel('Model ID', { exact: true })).toHaveValue('')
    await expect(configuration.getByLabel('Automatic recap on return')).toBeChecked()
    await expect(configuration.getByLabel('Use Jev to choose recap cards')).not.toBeChecked()
    const bookmarks = configuration.getByLabel('Keep Jev bookmarks as the conversation continues')
    await expect(bookmarks).not.toBeChecked()
    await expect(bookmarks).toBeDisabled()
    await expect(configuration.getByRole('button', { name: 'Save', exact: true })).toBeInViewport()
    await expect(configuration.getByLabel('Inactivity (minutes)')).toHaveValue('30')
    await expect(configuration).toHaveScreenshot(`settings-${scheme}-expanded.png`)
    const collapse = configuration.getByRole('button', {
      name: 'Collapse: Session recap',
      exact: true,
    })
    await collapse.click()
    await expect(configuration.getByLabel('Provider ID')).toHaveCount(0)
    const expand = configuration.getByRole('button', { name: 'Expand: Session recap', exact: true })
    await expect(configuration).toHaveScreenshot(`settings-${scheme}-collapsed.png`)
    await expand.focus()
    await expect(expand).toBeFocused()
    await expand.press('Enter')
    await expect(configuration.getByLabel('Provider ID')).toBeVisible()
    // The old Settings inventory comparison no longer applies: this is an
    // elected plugins.row.config page, not a peer of the native Shell card.
    await expect(configuration).not.toContainText('Shared OpenRouter key')
  })
}
