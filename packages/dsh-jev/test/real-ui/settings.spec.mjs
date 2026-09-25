import { test, expect, pluginSettings } from '../../../../tests/real-ui/fixtures.mjs'

test('Jev native settings uses shared credentials and saves its model without evaluation', async ({
  app,
}) => {
  const settings = await pluginSettings(app, 'dark')
  const card = settings.getByRole('group', { name: 'Jev settings' })
  await expect(card).toBeVisible()
  await card.locator('summary').click()
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
})
