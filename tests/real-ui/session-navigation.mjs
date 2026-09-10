// The disposable host seeds one persisted session in its workspace.
export async function openSeededSession(page) {
  const sessions = page.getByRole('tree', { name: 'Sessions', exact: true })
  const workspace = sessions.getByRole('treeitem', { name: 'workspace', exact: true })
  await workspace.waitFor({ state: 'visible' })
  // DSH 0.1.5 groups by workspace and normally starts expanded. An unconditional
  // click would collapse the group and hide the session we need to select.
  if (await workspace.getAttribute('aria-expanded') === 'false') await workspace.click()
  // The persisted row includes a relative age; the group and blank session do not.
  await sessions.getByRole('treeitem', { name: /^workspace\s/ }).click()
  await page.getByText('Review the Session recap interface.', { exact: true }).waitFor({ state: 'visible' })
}
