import {
  test,
  expect,
  pluginSettings,
  openSeededSession,
} from '../../../../tests/real-ui/fixtures.mjs'
import {
  githubSessionId,
  githubCallId,
  githubWorkspaceName,
  githubToolName,
  githubPrompt,
} from '../../../../tests/real-ui/github-grants-fixture.mjs'

// Real installed shared bundle and tool.call.toolview in the disposable DSH shell.
// Only browser display projections are synthetic; they grant no host authority.
const scope = {
  account: { id: 'U_fixture', login: 'fixture-maintainer' },
  operations: ['setProjectItemField', 'addIssueDependency'],
  issues: [43, 42].map((number) => ({
    id: `I_${number}`,
    repositoryId: 'R_fixture',
    repositoryOwnerId: 'O_fixture',
    nameWithOwner: 'fixture-org/demo',
    issueNumber: number,
    title:
      number === 43
        ? 'Review session-scoped issue management grants'
        : 'Readable project field changes',
    url: `https://github.com/fixture-org/demo/issues/${number}`,
  })),
  projects: [
    {
      id: 'P_fixture',
      ownerId: 'O_fixture',
      owner: 'fixture-org',
      projectNumber: 7,
      title: 'Delivery board',
      url: 'https://github.com/orgs/fixture-org/projects/7',
    },
  ],
  memberships: [
    { id: 'PVTI_43', issueId: 'I_43', projectId: 'P_fixture' },
    { id: 'PVTI_42', issueId: 'I_42', projectId: 'P_fixture' },
  ],
}
const exactPreview =
  'SYNTHETIC REVIEW ONLY — no authority\nAccount: fixture-maintainer (U_fixture)\nIssues: fixture-org/demo #43 (I_43), #42 (I_42)\nProject: fixture-org #7 (P_fixture)\nMemberships: PVTI_43, PVTI_42\nOperations: setProjectItemField, addIssueDependency\nOnly this live requesting session. No automatic renewal.'
function projection(phase = 'awaiting-approval', grants = [], history = []) {
  return {
    version: 1,
    toolName: githubToolName,
    callId: githubCallId,
    phase,
    scope,
    exactPreview,
    grants,
    history,
  }
}
const activeGrant = { id: 'grant-synthetic-43', state: 'active', scope }
const history = ['confirmed', 'failed', 'uncertain', 'unattempted'].map((outcome, index) => ({
  id: `change-${index}`,
  operation: index % 2 ? 'addIssueDependency' : 'setProjectItemField',
  outcome,
  preview: `Synthetic exact change ${index}: Status from Todo to In progress`,
}))

async function mockProjection(page, initial) {
  let value = initial
  const requests = []
  await page.route('**/api/plugins/github/*', async (route) => {
    const request = route.request(),
      action = new URL(request.url()).pathname.split('/').at(-1)
    const body = request.postDataJSON()
    requests.push({ action, body })
    expect(request.method()).toBe('POST')
    expect(request.headers()['x-dsh-github']).toBe('1')
    expect(body.sessionId).toBe(githubSessionId)
    expect(body.callId).toBe(githubCallId)
    if (action === 'revoke') {
      expect(body).toEqual({
        sessionId: githubSessionId,
        callId: githubCallId,
        grantId: activeGrant.id,
      })
      value = {
        ...value,
        phase: 'revoked',
        grants: value.grants.map((grant) => ({ ...grant, state: 'revoked' })),
      }
    } else {
      expect(action).toBe('status')
      expect(body).toEqual({ sessionId: githubSessionId, callId: githubCallId })
    }
    await route.fulfill({ json: { ok: true, value } })
  })
  return {
    requests,
    set(valueNext) {
      value = valueNext
    },
  }
}
async function openGrant(page, theme = 'light', narrow = false) {
  const settings = await pluginSettings(page, theme)
  await settings.getByRole('button', { name: 'Close', exact: true }).click()
  const sessions = page.getByRole('tree', { name: 'Sessions', exact: true })
  // The sibling cwd is intentionally not a saved workspace; DSH puts its
  // persisted session under Ungrouped, leaving the recap workspace unchanged.
  const workspace = sessions.getByRole('treeitem', { name: 'Ungrouped', exact: true })
  await expect(workspace).toBeVisible()
  if ((await workspace.getAttribute('aria-expanded')) !== 'true') await workspace.click()
  await sessions.getByRole('treeitem', { name: new RegExp(`^${githubWorkspaceName}\\s`) }).click()
  await expect(page.getByText(githubPrompt, { exact: true })).toBeVisible()
  const card = page.getByRole('region', { name: 'GitHub issue management grant', exact: true })
  await expect(
    card.getByRole('heading', { name: 'Manage selected issues for this session' }),
  ).toBeVisible()
  // Match the existing real-ui convention: constrain the actual slot, retaining
  // the shell's sidebar and styles rather than replacing them with a test page.
  if (narrow)
    await card.evaluate((element) => {
      element.style.width = '320px'
      element.style.maxWidth = '100%'
    })
  await page.evaluate(() => document.fonts.ready)
  return card
}
async function keyboardOpen(locator) {
  await locator.focus()
  await expect(locator).toBeFocused()
  await locator.press('Enter')
}
async function artifact(card, testInfo, name) {
  // No baseline exists. This is diagnostic screenshot evidence, not regression.
  const page = card.page()
  const bounds = await card.boundingBox()
  await page.setViewportSize({
    width: page.viewportSize().width,
    height: Math.ceil(bounds.height) + 600,
  })
  await card.scrollIntoViewIfNeeded()
  // Tool cards live in a scrolling conversation. A locator screenshot alone can
  // silently capture ancestor clipping; fit the whole card before collecting it.
  const visible = await card.boundingBox()
  expect(visible.y).toBeGreaterThanOrEqual(0)
  expect(visible.y + visible.height).toBeLessThanOrEqual(page.viewportSize().height)
  const path = testInfo.outputPath(`${name}.png`)
  await card.screenshot({ path })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

test('shared host mounts the real GitHub projection route without granting access', async ({
  app,
}) => {
  // APIRequestContext bypasses browser route mocks. An unexecuted fixture call
  // must be expired; this checks host bundle wiring, not the grant pipeline.
  const response = await app.request.post(new URL('/api/plugins/github/status', app.url()).href, {
    headers: {
      origin: new URL(app.url()).origin,
      'x-dsh-github': '1',
      'content-type': 'application/json',
    },
    data: { sessionId: githubSessionId, callId: githubCallId },
  })
  expect(response.status()).toBe(200)
  expect(await response.json()).toMatchObject({
    ok: true,
    value: { version: 1, phase: 'expired', grants: [], history: [] },
  })
})

for (const [theme, narrow] of [
  ['light', false],
  ['dark', false],
  ['light', true],
]) {
  test(`GitHub grant review in real shell (${theme}${narrow ? ', narrow' : ''})`, async ({
    app,
  }, testInfo) => {
    const mock = await mockProjection(app, projection())
    const card = await openGrant(app, theme, narrow)
    await expect(card.getByRole('status')).toHaveText('Awaiting approval')
    await expect(card.getByText('fixture-maintainer', { exact: false }).first()).toBeVisible()
    await expect(card.getByRole('heading', { name: 'Selected issues (2)' })).toBeVisible()
    await expect(card.getByRole('link', { name: /fixture-org\/demo #43/ })).toHaveAttribute(
      'href',
      scope.issues[0].url,
    )
    await expect(card.getByRole('link', { name: /fixture-org project #7/ })).toBeVisible()
    await expect(
      card.getByText('Update supported board fields for granted issue memberships', {
        exact: false,
      }),
    ).toBeVisible()
    await expect(
      card.getByText('Add a dependency between two granted issues', { exact: false }),
    ).toBeVisible()
    await expect(card.getByText(/No deletion, transfer, new issues/)).toBeVisible()
    await expect(card.getByText(/does not transfer to other sessions or subagents/)).toBeVisible()
    await keyboardOpen(
      card.locator('summary').filter({ hasText: 'Exact existing project memberships (2)' }),
    )
    await expect(
      card.getByText('Item ID: PVTI_43; Issue ID: I_43; Project ID: P_fixture'),
    ).toBeVisible()
    await keyboardOpen(
      card.locator('summary').filter({ hasText: 'Complete exact approval preview' }),
    )
    await expect(card.locator('pre').filter({ hasText: 'SYNTHETIC REVIEW ONLY' })).toHaveText(
      exactPreview,
    )
    await expect(card.getByRole('button', { name: /Revoke access/ })).toHaveCount(0)
    expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true,
    )
    expect(mock.requests.length).toBeGreaterThan(0)
    await artifact(card, testInfo, `grant-review-${theme}${narrow ? '-narrow' : ''}`)
  })
}

test('active grants, history, keyboard revoke, expired and renewal states', async ({
  app,
}, testInfo) => {
  const mock = await mockProjection(app, projection('active', [activeGrant], history))
  const card = await openGrant(app, 'dark')
  await expect(card.getByRole('status')).toHaveText('Active access')
  const grants = card.getByRole('region', { name: 'Session grants', exact: true })
  await keyboardOpen(grants.locator('summary').filter({ hasText: 'Review grant scope' }))
  await expect(grants.getByRole('heading', { name: 'Selected issues (2)' })).toBeVisible()
  const changes = card.getByRole('region', { name: 'Change history', exact: true })
  for (const outcome of ['confirmed', 'failed', 'uncertain', 'unattempted'])
    await expect(changes.getByRole('listitem').filter({ hasText: `: ${outcome}` })).toHaveCount(1)
  await expect(changes.getByRole('alert')).toHaveText(
    'The write may have succeeded. Do not retry automatically. Inspect GitHub before requesting fresh approval.',
  )
  await keyboardOpen(changes.locator('summary').first())
  await expect(changes.locator('pre').first()).toContainText(history[0].preview)
  await keyboardOpen(card.locator('summary').filter({ hasText: 'Raw tool details' }))
  await expect(card.locator('pre').filter({ hasText: 'Synthetic display fixture.' })).toBeVisible()
  await artifact(card, testInfo, 'grant-active-history-dark')
  const revoke = grants.getByRole('button', {
    name: `Revoke access ${activeGrant.id}`,
    exact: true,
  })
  await revoke.focus()
  await expect(revoke).toBeFocused()
  await revoke.press('Enter')
  await expect(card.getByRole('status')).toHaveText('Revoked')
  expect(mock.requests.filter((request) => request.action === 'revoke')).toHaveLength(1)
  await expect(grants.getByRole('button', { name: /Revoke/ })).toHaveCount(0)
  await expect(grants.getByText(/No access renews automatically/)).toBeVisible()
  for (const [phase, label] of [
    ['expired', 'Expired — fresh approval required'],
    ['renewal-required', 'Renewal required'],
  ]) {
    mock.set(projection(phase, [{ ...activeGrant, state: phase }], history))
    await keyboardOpen(card.getByRole('button', { name: 'Refresh status', exact: true }))
    await expect(card.getByRole('status')).toHaveText(label)
    await expect(card.getByText(/Renewal requires a new complete approval/)).toBeVisible()
    await expect(card.getByRole('button', { name: /Revoke access/ })).toHaveCount(0)
  }
  await artifact(card, testInfo, 'grant-renewal-dark')
  // A separate workspace must not make the original recap selector ambiguous.
  await openSeededSession(app)
  await expect(app.getByRole('region', { name: 'GitHub issue management grant' })).toHaveCount(0)
})
