import { test, expect, pluginSettings } from '../../../../tests/real-ui/fixtures.mjs'

test('Jev native settings uses shared credentials and saves its model without evaluation', async ({
  app,
}, testInfo) => {
  const settings = await pluginSettings(app, 'dark', '@local/dsh-jev', 'local-jev')
  const card = settings.getByRole('group', { name: 'Jev settings' })
  await expect(card).toBeVisible()
  await expect(card.locator('input[type=password]')).toHaveCount(0)
  await expect(
    card.getByText('Shared OpenRouter key: Not configured', { exact: true }),
  ).toBeVisible()
  const input = card.getByLabel('Jev model ID')
  await expect(input).toHaveValue('typesafe/jev-1.13')
  try {
    await input.fill('~typesafe/jev-latest')
    await card.getByRole('button', { name: 'Save Jev model' }).click()
    await expect(card.getByText('Jev model saved. No evaluation was sent.')).toBeVisible()
    await input.fill('openai/not-jev')
    await card.getByRole('button', { name: 'Save Jev model' }).click()
    await expect(card.getByRole('alert')).toBeVisible()
  } finally {
    await input.fill('typesafe/jev-1.13')
    await card.getByRole('button', { name: 'Save Jev model' }).click()
    await expect(card.getByText('Jev model saved. No evaluation was sent.')).toBeVisible()
  }
  for (const scheme of ['light', 'dark']) {
    await test.step(`${scheme} shared panel fits the real shell at desktop and narrow widths`, async () => {
      await app.setViewportSize({ width: 1100, height: 850 })
      await expect(app.getByRole('button', { name: 'Account menu', exact: true })).toBeVisible()
      const configuration = await pluginSettings(app, scheme, '@local/dsh-jev', 'local-jev')
      const panel = configuration.getByRole('group', { name: 'Jev settings' })
      await expect(panel.getByLabel('Jev model ID')).toHaveValue('typesafe/jev-1.13')
      if (scheme === 'dark') {
        const path = testInfo.outputPath('shared-settings-dark.png')
        await configuration.screenshot({ path })
        await testInfo.attach('Shared settings (diagnostic, disposable shell)', {
          path,
          contentType: 'image/png',
        })
      }
      await app.setViewportSize({ width: 430, height: 900 })
      const navigation = app.getByRole('dialog', { name: 'Navigation', exact: true })
      // Native responsive navigation closes asynchronously after a resize.
      await expect(navigation).toBeHidden()
      await expect
        .poll(async () => (await panel.getByLabel('Jev model ID').boundingBox()).width)
        .toBeGreaterThan(100)
      const bounds = await panel.getByLabel('Jev model ID').boundingBox()
      expect(bounds.width).toBeGreaterThan(100)
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(430)
      await expect(panel.getByRole('button', { name: 'Save Jev model' })).toBeInViewport()
    })
  }
})
