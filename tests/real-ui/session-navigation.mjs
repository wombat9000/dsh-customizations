// The disposable host seeds one persisted session in its workspace.
export async function openSeededSession(page) {
  const sessions = page.getByRole('tree', { name: 'Sessions', exact: true })
  // The root session may be under its saved workspace or Ungrouped after
  // another fixture changes the active workspace. Wait for sidebar hydration,
  // then expand existing groups without collapsing an already-open group.
  await sessions
    .getByRole('treeitem', { name: /^(?:workspace|Ungrouped)$/ })
    .first()
    .waitFor({ state: 'visible' })
  for (const name of ['workspace', 'Ungrouped']) {
    const group = sessions.getByRole('treeitem', { name, exact: true })
    if ((await group.count()) && (await group.getAttribute('aria-expanded')) === 'false')
      await group.click()
  }
  // The persisted row includes a relative age; the group and blank session do not.
  await sessions.getByRole('treeitem', { name: /^workspace\s/ }).click()
  await page
    .getByText('Review the Session recap interface.', { exact: true })
    .waitFor({ state: 'visible' })
}
