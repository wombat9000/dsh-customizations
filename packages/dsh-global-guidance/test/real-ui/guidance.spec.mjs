import { test, expect, setTheme, dismissOnboarding } from '../../../../tests/real-ui/fixtures.mjs'

const packageName = '@local/dsh-global-guidance'
const rowId = 'local-global-guidance-visual-evidence'
async function sections(page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/test/global-guidance', {
      method: 'POST',
      headers: { 'x-dsh-test': '1' },
    })
    if (!response.ok) throw new Error(`Guidance observation failed: ${response.status}`)
    return (await response.json()).sections
  })
}
async function openBundle(page) {
  await page.getByRole('button', { name: 'Plugins', exact: true }).click()
  const panel = page.locator('[data-plugin-panel]')
  await expect(panel).toBeVisible()
  for (let depth = 0; depth < 2; depth++) {
    const back = panel.getByRole('button', { name: /^Back to/ }).first()
    if (!(await back.isVisible())) break
    await back.click()
  }
  const card = page.locator(`[data-plugin-package="${packageName}"]`)
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: /^View/ }).click({ timeout: 5000 })
  const detail = page.locator(`[data-plugin-detail="${packageName}"]`)
  await expect(detail).toBeVisible()
  return detail
}

test('native Global Guidance switches control instructions and preserve the component selection', async ({
  app,
}, testInfo) => {
  await setTheme(app, 'dark')
  let detail = await openBundle(app)
  const bundle = () => detail.getByRole('switch', { name: 'Enable Global Guidance', exact: true })
  const component = () =>
    detail.getByRole('switch', { name: 'Enable component Visual evidence', exact: true })
  const row = () => detail.locator(`[data-plugin-row$="${rowId}"]`)
  const enabledSections = await sections(app)
  expect(enabledSections).toHaveLength(1)
  const body = enabledSections[0].text
  await expect(detail.getByText('Global Guidance', { exact: true })).toBeVisible()
  await expect(row()).toContainText('Visual evidence')
  await expect(row()).toContainText('Running')
  await expect(component()).toBeChecked()
  await expect(bundle()).toBeChecked()
  const path = testInfo.outputPath('global-guidance-dark.png')
  await detail.screenshot({ path })
  await testInfo.attach('Global Guidance native settings diagnostic (not baseline)', {
    path,
    contentType: 'image/png',
  })
  try {
    await test.step('Component toggle removes guidance without disabling the bundle', async () => {
      await component().click()
      await expect(component()).not.toBeChecked()
      await expect(bundle()).toBeChecked()
      await expect.poll(() => sections(app)).toEqual([])
      await app.reload()
      await dismissOnboarding(app)
      detail = await openBundle(app)
      await expect(component()).not.toBeChecked()
      await expect.poll(() => sections(app)).toEqual([])
    })
    await test.step('Bundle cycling retains the disabled component and its metadata', async () => {
      await bundle().click()
      await expect(bundle()).not.toBeChecked()
      await expect.poll(() => sections(app)).toEqual([])
      await expect(detail.getByText('Visual evidence', { exact: true })).toBeVisible()
      await bundle().click()
      await expect(bundle()).toBeChecked()
      await expect(component()).not.toBeChecked()
      await expect.poll(() => sections(app)).toEqual([])
    })
    await test.step('Re-enable the component, then cycle the enabled bundle', async () => {
      await component().click()
      await expect.poll(() => sections(app)).toEqual(enabledSections)
      await bundle().click()
      await expect.poll(() => sections(app)).toEqual([])
      await bundle().click()
      await expect.poll(() => sections(app)).toEqual(enabledSections)
      await app.reload()
      await dismissOnboarding(app)
      detail = await openBundle(app)
      await expect(component()).toBeChecked()
      expect((await sections(app))[0].text).toBe(body)
    })
  } finally {
    if (!(await detail.isVisible())) detail = await openBundle(app)
    // Shared host state belongs to the whole suite. Restore both native controls
    // even after a failed assertion; never use a test-only production reset API.
    if (!(await bundle().isChecked())) await bundle().click()
    await expect(bundle()).toBeChecked()
    await expect(component()).toBeEnabled()
    if (!(await component().isChecked())) await component().click()
    await expect.poll(() => sections(app)).toEqual(enabledSections)
  }
})
