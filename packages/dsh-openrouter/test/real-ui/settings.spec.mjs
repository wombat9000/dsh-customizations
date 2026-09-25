import { test, expect, pluginSettings } from '../../../../tests/real-ui/fixtures.mjs'

test('shared OpenRouter card edits only the disposable host credential', async ({ app }) => {
  const settings = await pluginSettings(app, 'light')
  const card = settings.getByRole('group', { name: 'OpenRouter settings' })
  // Native details has group semantics; namespace dispatch must elect this new card.
  await expect(card).toBeVisible()
  await card.locator('summary').click()
  const field = card.getByLabel('OpenRouter API key')
  await expect(field).toHaveValue('')
  await expect(field).toHaveAttribute('type', 'password')
  await field.fill('sk-or-fixture-not-a-real-key')
  await card.getByRole('button', { name: 'Save shared key' }).click()
  await expect(
    card.getByText('Shared OpenRouter key saved. No remote request was made.'),
  ).toBeVisible()
  await expect(field).toHaveValue('')
  await expect(card).not.toContainText('sk-or-fixture-not-a-real-key')
  app.once('dialog', (dialog) => dialog.accept())
  await card.getByRole('button', { name: 'Remove shared key' }).click()
  await expect(
    card.getByText('Stored key removed. Effective credential status refreshed.'),
  ).toBeVisible()
  await expect(card.getByRole('button', { name: 'Remove shared key' })).toBeDisabled()
})
