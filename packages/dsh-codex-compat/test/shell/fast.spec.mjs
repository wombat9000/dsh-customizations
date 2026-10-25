import {
  test,
  expect,
  openSeededSession,
  dismissOnboarding,
  pluginSettings,
  setTheme,
} from '../../../../tests/real-ui/fixtures.mjs'

test.use({ configuredProvider: true })

// Real generated bundle, native slots, authenticated RPC, model projection and durable storage.
// No OAuth login, prompt submission or live provider calls. Screenshots are diagnostic, not baselines.
test('three-state Fast choice survives reload and integration Off preserves the native model picker', async ({
  app: page,
}, testInfo) => {
  const fast = () => page.getByRole('button', { name: /^Fast mode:/ })
  await test.step('cycle the two-bolt control beside the native model picker', async () => {
    await openSeededSession(page)
    await setTheme(page, 'dark')
    await openSeededSession(page)
    await expect(fast()).toBeEnabled()
    await expect(fast()).toHaveAccessibleName('Fast mode: Off')
    const model = page.getByRole('button', { name: /GPT-6 Sol/ })
    // Prove election in input.right and adjacency to the native picker.
    const group = page.locator('[data-codex-fast-control]')
    await expect(group.getByRole('button')).toHaveCount(1)
    const controlBox = await group.boundingBox()
    const modelBox = await model.boundingBox()
    expect(modelBox.x - (controlBox.x + controlBox.width)).toBeGreaterThanOrEqual(0)
    expect(modelBox.x - (controlBox.x + controlBox.width)).toBeLessThan(24)
    expect(Math.abs(modelBox.y - controlBox.y)).toBeLessThan(12)
    await expect(fast()).toHaveAttribute('title', /2.5× included usage/)
    await fast().click()
    await expect(fast()).toHaveAccessibleName('Fast mode: Everything Fast')
    await page.screenshot({ path: testInfo.outputPath('fast-all.png') })
    await fast().click()
    await expect(fast()).toHaveAccessibleName('Fast mode: Main thread only')
    await page.screenshot({ path: testInfo.outputPath('fast-main.png') })
    await fast().click()
    await expect(fast()).toHaveAccessibleName('Fast mode: Off')
    await fast().click()
    await expect(fast()).toHaveAccessibleName('Fast mode: Everything Fast')
    await page.setViewportSize({ width: 390, height: 850 })
    await expect(fast()).toBeInViewport()
    await expect(model).toBeInViewport()
    const narrow = await group.boundingBox()
    expect(narrow.x).toBeGreaterThanOrEqual(0)
    expect(narrow.x + narrow.width).toBeLessThanOrEqual(390)
    await page.screenshot({ path: testInfo.outputPath('fast-all-narrow.png') })
    await page.setViewportSize({ width: 1100, height: 850 })
  })
  await test.step('reload and retain both the Everything Fast and Main only choices', async () => {
    await page.reload()
    await dismissOnboarding(page, { configuredProvider: true, previewAcknowledged: true })
    await openSeededSession(page)
    await expect(fast()).toHaveAccessibleName('Fast mode: Everything Fast')
    await fast().click()
    await expect(fast()).toHaveAccessibleName('Fast mode: Main thread only')
    await page.reload()
    await dismissOnboarding(page, { configuredProvider: true, previewAcknowledged: true })
    await openSeededSession(page)
    await expect(fast()).toHaveAccessibleName('Fast mode: Main thread only')
  })
  await test.step('disable only the integration from its native plugin configuration', async () => {
    const config = await pluginSettings(page, 'dark', '@local/dsh-codex-compat', 'local-codex-fast')
    const integration = config.getByRole('switch', { name: 'Codex Fast integration', exact: true })
    await expect(integration).toHaveAttribute('aria-checked', 'true')
    await integration.click()
    await expect(integration).toHaveAttribute('aria-checked', 'false')
    await expect(config.getByText(/Codex login and Standard inference do not depend/)).toBeVisible()
    await expect(integration).toBeEnabled()
  })
  await test.step('return to the composer with Fast off and native model selection intact', async () => {
    await page.getByRole('button', { name: 'Plugins', exact: true }).click()
    await openSeededSession(page)
    await expect(fast()).toHaveAccessibleName('Fast mode: Off')
    await page.getByRole('button', { name: /GPT-6 Sol/ }).click()
    const picker = page.getByRole('menu', { name: 'Model and reasoning effort', exact: true })
    await expect(picker).toBeVisible()
    await expect(
      picker.getByRole('menuitem', { name: 'Model GPT-6 Sol', exact: true }),
    ).toBeVisible()
    await expect(
      picker.getByRole('menuitem', { name: 'Effort Default', exact: true }),
    ).toBeVisible()
    await page.keyboard.press('Escape')
    await setTheme(page, 'light')
    await page.screenshot({ path: testInfo.outputPath('fast-off.png') })
  })
})
