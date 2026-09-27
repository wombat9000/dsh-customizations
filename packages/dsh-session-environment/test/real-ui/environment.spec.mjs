import { test, expect, openSeededSession } from '../../../../tests/real-ui/fixtures.mjs'
import { githubFieldWorkspaceName } from '../../../../tests/real-ui/github-field-fixture.mjs'

test('environment reads the target Remote and follows the retained main-view session', async ({
  app,
}) => {
  await openSeededSession(app)
  const card = app.getByRole('region', { name: 'Session environment', exact: true })
  await expect(card).toBeVisible()
  await expect(card.getByRole('button', { name: /^Copy CWD: .*\/workspace$/ })).toBeVisible()
  // These disposable directories are intentionally not Git repositories. This
  // result proves the real Remote codec and host Shell.execute/result path,
  // rather than accepting a UI-only loading or unavailable placeholder.
  await expect(card.getByText('Not a Git repository', { exact: true })).toBeVisible()
  await app
    .getByRole('tree', { name: 'Sessions', exact: true })
    .getByRole('treeitem', { name: new RegExp(`^${githubFieldWorkspaceName}\\s`) })
    .click()
  await expect(
    card.getByRole('button', { name: new RegExp(`^Copy CWD: .*/${githubFieldWorkspaceName}$`) }),
  ).toBeVisible()
  await expect(card.getByText('Not a Git repository', { exact: true })).toBeVisible()
  await expect(card.getByRole('button', { name: /^Copy CWD: .*\/workspace$/ })).toHaveCount(0)
})
