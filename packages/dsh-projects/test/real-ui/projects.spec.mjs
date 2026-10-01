import { test, expect } from '../../../../tests/real-ui/fixtures.mjs'

test('navigate sessionless Projects and persist local configuration through reload', async ({
  app,
}) => {
  await test.step('Native root sidebar and main slot without a session', async () => {
    await app.getByRole('button', { name: 'Projects', exact: true }).click()
    await expect(app.getByRole('region', { name: 'Projects', exact: true })).toBeVisible()
    await expect(app.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
    await app.getByRole('button', { name: 'Plugins', exact: true }).click()
    await expect(app.getByRole('region', { name: 'Projects', exact: true })).not.toBeVisible()
    await app.getByRole('button', { name: 'Projects', exact: true }).click()
    await expect(app.getByRole('region', { name: 'Projects', exact: true })).toBeVisible()
  })

  await test.step('Local settings survive reload without tracker writes', async () => {
    await app.getByRole('button', { name: 'Projects', exact: true }).click()
    await app.getByRole('button', { name: 'Configure projects', exact: true }).click()
    const editor = app.getByRole('textbox', { name: 'Teams and projects JSON' })
    const original = await editor.inputValue()
    try {
      await editor.fill(
        JSON.stringify({
          teams: [
            { id: 'shell-team', name: 'Shell team', conventions: { workflow: 'Review first' } },
          ],
          projects: [
            {
              id: 'shell-project',
              name: 'Shell project',
              teamId: 'shell-team',
              conventions: {},
              sources: [],
            },
          ],
        }),
      )
      await app.getByRole('button', { name: 'Save local settings', exact: true }).click()
      await expect(app.getByRole('status')).toContainText('Local settings saved')
      await app.reload()
      await app.getByRole('button', { name: 'Configure later', exact: true }).click()
      await app.getByRole('button', { name: 'Projects', exact: true }).click()
      await app
        .getByRole('combobox', { name: 'Project', exact: true })
        .selectOption('shell-project')
      await expect(app.getByRole('heading', { name: 'Shell project' })).toBeVisible()
      await app.getByText('Resolved conventions', { exact: true }).click()
      await expect(app.getByText('Review first', { exact: false })).toBeVisible()
      await expect(app.getByText('— Team: Shell team', { exact: true })).toBeVisible()
    } finally {
      await app.getByRole('button', { name: 'Configure projects', exact: true }).click()
      await editor.fill(original)
      await app.getByRole('button', { name: 'Save local settings', exact: true }).click()
      await expect(app.getByRole('status')).toContainText('Local settings saved')
    }
  })
})
