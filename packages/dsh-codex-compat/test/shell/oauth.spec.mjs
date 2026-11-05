import { test, expect, openSettings } from '../../../../tests/real-ui/fixtures.mjs'

test.use({ configuredProvider: true })

test('the Codex provider card offers reconnect and clears the one-time code after sign-in', async ({
  app: page,
}, testInfo) => {
  let authorized = false
  // Exercise the generated Client and native Models slot with fixture replies. No real OAuth.
  await page.route('**/codex-reconnect/**', async (route) => {
    const { rpcId, method, payload } = route.request().postDataJSON()
    if (method === 'status') expect(payload).toEqual({ id: 'fixture-attempt' })
    const value =
      method === 'start'
        ? { id: 'fixture-attempt' }
        : authorized
          ? { phase: 'authorized' }
          : { phase: 'code', code: 'CODE-123' }
    await route.fulfill({ json: { type: 'server-response', rpcId, result: { ok: true, value } } })
  })

  await openSettings(page)
  await page.getByRole('button', { name: 'Models', exact: true }).click()
  const reconnect = page.getByRole('button', { name: 'Reconnect Codex', exact: true })
  await expect(reconnect).toBeEnabled()
  await expect(page.getByRole('button', { name: /^Edit .*Codex/ })).toBeVisible()
  await reconnect.click()
  await expect(page.getByText('CODE-123', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open OpenAI sign-in' })).toHaveAttribute(
    'href',
    'https://auth.openai.com/codex/device',
  )
  await expect(page.getByRole('button', { name: 'Cancel sign-in' })).toBeEnabled()
  await page.screenshot({ path: testInfo.outputPath('codex-reconnect.png') })
  authorized = true
  await expect(page.getByText('Codex reconnected. You can retry your turn.')).toBeVisible()
  await expect(page.getByText('CODE-123', { exact: true })).toHaveCount(0)
  await expect(reconnect).toBeEnabled()
})
