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
    await setTheme(page, 'dark')
    await openSeededSession(page)
    const fast = page.getByRole('switch', { name: 'Codex Fast mode', exact: true })
    await expect(fast).toBeEnabled()
    await expect(fast).toHaveAttribute('aria-checked', 'false')
    const options = page.getByRole('button', { name: 'Fast options', exact: true })
    const model = page.getByRole('button', { name: /GPT-6 Sol/ })
    // Prove election in input.right and adjacency to the native picker, not just registration spelling.
    const group = page.locator('[data-codex-fast-control]')
    const controlBox = await group.boundingBox()
    const modelBox = await model.boundingBox()
    expect(modelBox.x - (controlBox.x + controlBox.width)).toBeGreaterThanOrEqual(0)
    expect(modelBox.x - (controlBox.x + controlBox.width)).toBeLessThan(24)
    expect(Math.abs(modelBox.y - controlBox.y)).toBeLessThan(12)
    await options.click()
    await expect(page.getByText(/Fast mode uses subscription limits/)).toBeVisible()
    const children = page.getByRole('switch', { name: 'Subagents Fast', exact: true })
    await expect(children).toHaveAttribute('aria-checked', 'false')
    await children.click()
    await expect(children).toHaveAttribute('aria-checked', 'true')
    await expect(fast).toHaveAttribute('aria-checked', 'false')
    await page.screenshot({ path: testInfo.outputPath('subagents-fast.png') })
    const editor = await page
      .getByRole('textbox', {
        name: 'Message or run a task, / commands, @ files or sessions',
        exact: true,
      })
      .boundingBox()
    const disclosure = await group
      .getByRole('region', { name: 'Fast options', exact: true })
      .boundingBox()
    const currentControl = await group.boundingBox()
    const x = Math.max(0, editor.x - 16)
    const y = Math.max(0, disclosure.y - 12)
    await page.screenshot({
      path: testInfo.outputPath('fast-options-detail.png'),
      clip: {
        x,
        y,
        width: page.viewportSize().width - x - 16,
        height: currentControl.y + currentControl.height + 16 - y,
      },
    })
    await page.keyboard.press('Escape')
    await expect(options).toHaveAttribute('aria-expanded', 'false')
    await fast.click()
    await expect(fast).toHaveAttribute('aria-checked', 'true')
    await page.screenshot({ path: testInfo.outputPath('composer-fast.png') })
    await page.setViewportSize({ width: 390, height: 850 })
    await options.click()
    await expect(children).toBeInViewport()
    const panel = await group
      .getByRole('region', { name: 'Fast options', exact: true })
      .boundingBox()
    expect(panel.x).toBeGreaterThanOrEqual(0)
    expect(panel.x + panel.width).toBeLessThanOrEqual(390)
    await expect(model).toBeInViewport()
    await page.screenshot({ path: testInfo.outputPath('subagents-fast-narrow.png') })
    await page.keyboard.press('Escape')
    await page.setViewportSize({ width: 1100, height: 850 })
  })
  await test.step('reload the page and retain the session-only choice', async () => {
    await page.reload()
    await dismissOnboarding(page, { configuredProvider: true, previewAcknowledged: true })
    await openSeededSession(page)
    await expect(
      page.getByRole('switch', { name: 'Codex Fast mode', exact: true }),
    ).toHaveAttribute('aria-checked', 'true')
    await page.getByRole('button', { name: 'Fast options', exact: true }).click()
    await expect(page.getByRole('switch', { name: 'Subagents Fast', exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await page.keyboard.press('Escape')
  })
  await test.step('disable only the integration from its native plugin configuration', async () => {
    const config = await pluginSettings(page, 'dark', '@local/dsh-codex-compat', 'local-codex-fast')
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
    await page.getByRole('button', { name: 'Fast options', exact: true }).click()
    await expect(page.getByRole('switch', { name: 'Subagents Fast', exact: true })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    await page.keyboard.press('Escape')
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
