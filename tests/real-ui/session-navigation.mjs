// The disposable host seeds one persisted session in its workspace.
export async function openSeededSession(page) {
  const sessions = page.getByRole('tree', { name: 'Sessions', exact: true })
  // The root session may be under its saved workspace or Ungrouped after
  // another fixture changes the active workspace. Wait for sidebar hydration,
  // then expand existing groups without collapsing an already-open group.
  await sessions
    .getByRole('treeitem', {
      name: /^(?:workspace|Ungrouped)(?: New session in (?:workspace|Ungrouped))?$/,
    })
    .first()
    .waitFor({ state: 'visible' })
  for (const name of ['workspace', 'Ungrouped']) {
    const group = sessions.getByRole('treeitem', {
      name: new RegExp(`^${name}(?: New session in ${name})?$`),
    })
    if ((await group.count()) && (await group.getAttribute('aria-expanded')) === 'false')
      await group.click()
  }
  // Six seeded sessions exceed the native five-row preview. Expand it through
  // the native button rather than changing host settings or seeding a selection.
  const persisted = sessions.getByRole('treeitem', { name: /^workspace\s(?!New session in )/ })
  if (!(await persisted.count())) {
    const more = sessions.getByRole('button', { name: /^Show \d+ more sessions$/ })
    if ((await more.count()) === 1) await more.click()
  }
  // The persisted row includes a relative age; the group and blank session do not.
  await persisted.click()
  await page
    .getByText('Review the Session recap interface.', { exact: true })
    .waitFor({ state: 'visible' })
}
