import { test, expect, pluginSettings } from '../../../../tests/real-ui/fixtures.mjs'

test('shared OpenRouter card edits only the disposable host credential', async ({ app }) => {
  const settings = await pluginSettings(app, 'light', '@local/dsh-openrouter', 'local-openrouter')
  const card = settings.getByRole('group', { name: 'OpenRouter settings' })
  // Native details has group semantics; namespace dispatch must elect this new card.
  await expect(card).toBeVisible()
  const field = card.getByLabel('OpenRouter API key')
  const remove = card.getByRole('button', { name: 'Remove shared key' })
  const acceptRemoval = (dialog) => dialog.accept()
  await expect(field).toHaveValue('')
  await expect(field).toHaveAttribute('type', 'password')
  try {
    await test.step('Save through real credential RPC without exposing the draft', async () => {
      await field.fill('sk-or-fixture-not-a-real-key')
      await card.getByRole('button', { name: 'Save shared key' }).click()
      await expect(
        card.getByText('Shared OpenRouter key saved. No remote request was made.'),
      ).toBeVisible()
      await expect(field).toHaveValue('')
      await expect(card).not.toContainText('sk-or-fixture-not-a-real-key')
    })
    await test.step('Confirm removal and refresh the effective credential status', async () => {
      app.once('dialog', acceptRemoval)
      await remove.click()
      await expect(
        card.getByText('Stored key removed. Effective credential status refreshed.'),
      ).toBeVisible()
      await expect(remove).toBeDisabled()
    })
  } finally {
    app.removeListener('dialog', acceptRemoval)
    // A failed assertion after Save must not leave a shared disposable key that
    // changes later plugins' credential-status fixtures.
    await expect(field).toBeEnabled()
    if (await remove.isEnabled()) {
      app.once('dialog', acceptRemoval)
      try {
        await remove.click()
        await expect(
          card.getByText('Stored key removed. Effective credential status refreshed.'),
        ).toBeVisible()
        await expect(field).toBeEnabled()
        await expect(remove).toBeDisabled()
      } finally {
        app.removeListener('dialog', acceptRemoval)
      }
    }
  }
})
