import {
  test,
  expect,
  openSeededSession,
  pluginSettings,
} from '../../../../tests/real-ui/fixtures.mjs'

// Only fixture diagnostics cross the real authenticated browser transport. No
// setting enables the host's background evaluator and no provider is configured.
const bookmarks = {
  version: 1,
  questionSetVersion: 'bookmarks-native-fixture-v1',
  model: 'fixture/never-dispatched',
  status: 'ready',
  processedMessages: 3,
  items: [
    {
      id: 'proposal',
      messageId: '<img src=x onerror=alert(1)>',
      kind: 'next_step',
      role: 'assistant',
      status: 'proposed',
      support: 0.91,
    },
    {
      id: 'question',
      messageId: 'fixture-question',
      kind: 'question',
      role: 'user',
      status: 'open',
      support: 0.93,
    },
    {
      id: 'completion',
      messageId: 'fixture-action',
      kind: 'next_step',
      role: 'assistant',
      status: 'completed',
      support: 0.94,
      updatedByMessageId: 'fixture-update',
      transitionScore: 0.88,
    },
  ],
}

test('bookmark diagnostics inspect and copy in the native shell without evaluation', async ({
  app,
}, testInfo) => {
  const calls = []
  await app.route('**/session-recap/*', async (route) => {
    const request = route.request().postDataJSON()
    calls.push(request.method)
    if (request.method !== 'recap') return route.fallback()
    await route.fulfill({
      json: {
        type: 'server-response',
        rpcId: request.rpcId,
        result: {
          ok: true,
          value: {
            sessionId: request.payload.sessionId,
            selection: { mode: 'bookmarks', bookmarks },
            recap: {
              headline: 'Bookmark fixture',
              cards: [
                { label: 'next_step', text: 'A private fixture proposal, not user approval.' },
              ],
            },
          },
        },
      },
    })
  })
  await openSeededSession(app)
  await app.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      writable: true,
      value: async (text) => {
        window.__copiedBookmarkDiagnostics = text
      },
    })
  })
  await app.getByRole('button', { name: 'Generate recap', exact: true }).click()
  const dock = app.getByRole('complementary', { name: 'Session recap' })
  const details = dock
    .locator('details')
    .filter({ has: app.locator('summary', { hasText: /^Bookmark details$/ }) })
  await expect(details).not.toHaveAttribute('open', '')
  const beforeInspection = [...calls]
  await details.locator('summary').first().focus()
  await app.keyboard.press('Enter')
  await expect(details).toHaveAttribute('open', '')
  for (const text of [
    'Proposed (not approved)',
    'Completion reported',
    'fixture-update (0.88)',
    '<img src=x onerror=alert(1)>',
  ]) {
    await expect(details.getByRole('cell', { name: text, exact: true })).toBeVisible()
  }
  await expect(details.getByRole('rowheader', { name: 'Open question', exact: true })).toBeVisible()
  await expect(details.locator('img, script')).toHaveCount(0)
  await details.getByRole('button', { name: 'Copy bookmark diagnostics JSON' }).click()
  await expect(details.getByText('Bookmark diagnostics copied.', { exact: true })).toBeVisible()
  const copied = await app.evaluate(() => window.__copiedBookmarkDiagnostics)
  expect(JSON.parse(copied)).toEqual(bookmarks)
  expect(copied).not.toContain('A private fixture proposal')
  expect(calls).toEqual(beforeInspection)
  await dock.screenshot({ path: testInfo.outputPath('bookmark-details.png') })
  await app.evaluate(() => {
    navigator.clipboard.writeText = async () => {
      throw Error('PRIVATE FIXTURE CLIPBOARD ERROR')
    }
  })
  await details.getByRole('button', { name: 'Copy bookmark diagnostics JSON' }).click()
  await expect(
    details.getByText('Clipboard unavailable. Expand the JSON and copy it manually.', {
      exact: true,
    }),
  ).toBeVisible()
  await expect(dock).not.toContainText('PRIVATE FIXTURE CLIPBOARD ERROR')
  await app.getByRole('button', { name: 'Hide recap', exact: true }).click()
  await app.getByRole('button', { name: 'Show recap', exact: true }).click()
  await expect(details).not.toHaveAttribute('open', '')
  expect(calls).toEqual(beforeInspection)
  await app.getByRole('button', { name: 'New session', exact: true }).first().click()
  await expect(dock).toHaveCount(0)
})

test('native bookmark opt-in stays default-off and saves only to a fixture RPC', async ({
  app,
}) => {
  let settings = {
    autoRecap: false,
    useJev: false,
    bookmarkJev: false,
    inactivityMinutes: 30,
    provider: '',
    model: '',
  }
  const writes = []
  await app.route('**/session-recap/*', async (route) => {
    const request = route.request().postDataJSON()
    let value
    if (request.method === 'settings') value = settings
    else if (request.method === 'models') value = { providers: [] }
    else if (request.method === 'configure') {
      writes.push(request.payload)
      settings = { ...request.payload }
      value = settings
    } else {
      // Never forward an accidental evaluator request from this opt-in fixture.
      await route.abort()
      throw Error(`Unexpected opt-in fixture RPC: ${request.method}`)
    }
    await route.fulfill({
      json: { type: 'server-response', rpcId: request.rpcId, result: { ok: true, value } },
    })
  })
  const configuration = await pluginSettings(app, 'light')
  const checkbox = configuration.getByRole('checkbox', {
    name: 'Keep Jev bookmarks as the conversation continues',
  })
  await expect(checkbox).not.toBeChecked()
  await expect(checkbox).toBeDisabled()
  await expect(configuration).toContainText('even if you never open a recap')
  await expect(configuration).toContainText('API charges')
  await expect(configuration).toContainText('OpenRouter')
  await expect(configuration).toContainText('TypeSafe')
  await configuration.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(
    configuration.getByText('Session recap settings saved.', { exact: true }),
  ).toBeVisible()
  expect(writes[0].bookmarkJev).toBe(false)
  await configuration.getByRole('checkbox', { name: 'Use Jev to choose recap cards' }).check()
  await expect(checkbox).toBeEnabled()
  await checkbox.check()
  await configuration.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(() => writes.length).toBe(2)
  expect(writes[1]).toEqual({
    autoRecap: false,
    useJev: true,
    bookmarkJev: true,
    inactivityMinutes: 30,
    provider: '',
    model: '',
  })
  // All settings responses and writes above are page-local; the disposable host
  // retains its actual default-off setting, so no shared-state restore is needed.
})
