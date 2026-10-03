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
test('Fast choice survives reload and integration Off preserves the native model picker', async ({
  app: page,
}, testInfo) => {
  await test.step('select Fast in the native composer', async () => {
    await openSeededSession(page)
    const fast = page.getByRole('switch', { name: 'Codex Fast mode', exact: true })
    await expect(fast).toBeEnabled()
    await expect(fast).toHaveAttribute('aria-checked', 'false')
    await page.getByText('Higher usage', { exact: true }).click()
    await expect(page.getByText(/Fast mode uses subscription limits/)).toBeVisible()
    await fast.click()
    await expect(fast).toHaveAttribute('aria-checked', 'true')
    await page.getByText('Higher usage', { exact: true }).click()
    await page.screenshot({ path: testInfo.outputPath('composer-fast.png') })
  })
  await test.step('reload the page and retain the session-only choice', async () => {
    await page.reload()
    await dismissOnboarding(page, { configuredProvider: true, previewAcknowledged: true })
    await openSeededSession(page)
    await expect(
      page.getByRole('switch', { name: 'Codex Fast mode', exact: true }),
    ).toHaveAttribute('aria-checked', 'true')
  })
  await test.step('disable only the integration from its native plugin configuration', async () => {
    const config = await pluginSettings(page, 'dark', '@local/dsh-codex-fast', 'local-codex-fast')
    const integration = config.getByRole('switch', { name: 'Codex Fast integration', exact: true })
    await expect(integration).toHaveAttribute('aria-checked', 'true')
    await integration.click()
    await expect(integration).toHaveAttribute('aria-checked', 'false')
    await expect(config.getByText(/Codex login and Standard inference do not depend/)).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('integration-off.png') })
    // Plugin stays mounted and its recovery control remains operable.
    await expect(integration).toBeEnabled()
  })
  await test.step('return to the composer with Fast off and native model selection intact', async () => {
    await page.getByRole('button', { name: 'Plugins', exact: true }).click()
    await openSeededSession(page)
    const fast = page.getByRole('switch', { name: 'Codex Fast mode', exact: true })
    await expect(fast).toHaveAttribute('aria-checked', 'false')
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
    await page.screenshot({ path: testInfo.outputPath('standard-composer.png') })
  })
})
