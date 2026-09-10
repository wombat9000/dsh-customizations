import { test, expect, pluginSettings, openSeededSession } from '../../../../tests/real-ui/fixtures.mjs'

for (const [theme, narrow] of [['light', false], ['dark', false], ['light', true]]) {
  test(`concise generated recap (${theme}${narrow ? ', narrow' : ''})`, async ({ app }) => {
    await app.route('**/session-recap/*', async route => {
      const request = route.request().postDataJSON()
      if (request.method !== 'recap') return route.fallback()
      await route.fulfill({ json: { type: 'server-response', rpcId: request.rpcId, result: { ok: true, value: {
        sessionId: request.payload.sessionId, generatedAt: '2026-01-02T03:04:05.000Z',
        recap: { bullets: [
          'The recap should refresh your memory of the thread, not report task status.',
          'Keep the topic, key direction, and stopping point in three short bullets.',
          'We paused at reviewing the simpler card and its send-to-hide behavior.',
        ] },
      } } } })
    })
    const settings = await pluginSettings(app, theme)
    await settings.getByRole('button', { name: 'Close', exact: true }).click()
    await openSeededSession(app)
    await app.getByRole('button', { name: 'Recap', exact: true }).click()
    const dock = app.getByRole('complementary', { name: 'Session recap' })
    await expect(dock.getByRole('listitem')).toHaveCount(3)
    await expect(dock.locator('button, svg, small, strong')).toHaveCount(0)
    if (narrow) await dock.evaluate(element => { element.style.width = '300px' })
    await app.evaluate(() => document.fonts.ready)
    await expect(dock).toHaveScreenshot(`recap-bullets-${theme}${narrow ? '-narrow' : ''}.png`)
  })
}

for (const theme of ['light', 'dark']) {
  test(`real dock follows persisted and blank sessions without calling a provider (${theme})`, async ({ app }) => {
    const settings = await pluginSettings(app, theme)
    const prefix = theme === 'light' ? 'recap' : 'recap-dark'
    await settings.getByRole('button', { name: 'Close', exact: true }).click()
    await openSeededSession(app)
    await expect(app.getByText('Review the Session recap interface.', { exact: true })).toBeVisible()
    const dock = app.getByRole('complementary', { name: 'Session recap' })
    await expect(dock).toHaveCount(0)
    const recap = app.getByRole('button', { name: 'Recap', exact: true })
    await expect(recap).toBeVisible()
    await expect(recap).toHaveScreenshot(`${prefix}-existing-session.png`)
    await recap.click()
    await expect(dock.getByRole('alert')).toHaveText('Choose a provider and model in Settings → Plugins → Session Recap.')
    await expect(dock).toHaveScreenshot(`${prefix}-no-provider.png`)
    await expect(dock.getByRole('button')).toHaveCount(0)
    await expect(dock.locator('svg, small, strong')).toHaveCount(0)
    await app.getByRole('button', { name: 'New session', exact: true }).first().click()
    await expect(recap).toHaveCount(0)
    await expect(app.getByRole('complementary', { name: 'Session recap' })).toHaveCount(0)
    await expect(app.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled()
  })
}
