import { test, expect, pluginSettings } from '../../../../tests/real-ui/fixtures.mjs'

for (const scheme of ['light', 'dark']) {
  test(`real plugin settings in ${scheme} mode`, async ({ app }) => {
    const dialog = await pluginSettings(app, scheme)
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0)
    await expect(dialog).toHaveScreenshot(`settings-${scheme}-collapsed.png`)
    await dialog.getByRole('button', { name: 'Expand: Session recap' }).click()
    await expect(dialog.getByLabel('Provider ID')).toHaveValue('')
    await expect(dialog.getByLabel('Model ID')).toHaveValue('')
    await expect(dialog.getByLabel('Automatic recap on return')).toBeChecked()
    await expect(dialog.getByLabel('Inactivity (minutes)')).toHaveValue('30')
    await dialog.getByRole('heading', { name: 'Plugins', exact: true }).click()
    await expect(dialog).toHaveScreenshot(`settings-${scheme}-expanded.png`)
    await dialog.getByRole('button', { name: 'Collapse: Session recap' }).click()
    await expect(dialog.getByLabel('Provider ID')).toHaveCount(0)
  })
}
