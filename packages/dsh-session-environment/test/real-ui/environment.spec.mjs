import { test, expect, openSeededSession } from '../../../../tests/real-ui/fixtures.mjs'
import { githubFieldWorkspaceName } from '../../../../tests/real-ui/github-field-fixture.mjs'
import { environmentCIWorkspace, environmentCIPrompt } from './ci-fixture.mjs'

const environmentCard = (app) =>
  app.getByRole('region', { name: 'Session environment', exact: true, includeHidden: true })
const foregroundSidebar = (app) => app.locator('[data-sidebar-right-panel]:not([hidden] *)')

async function closeSidebar(app) {
  const panel = foregroundSidebar(app)
  if (!(await panel.count()) || !(await panel.getAttribute('data-sidebar-right-open'))) return
  const exitFullscreen = panel.getByRole('button', { name: 'Exit fullscreen', exact: true })
  if (app.viewportSize().width >= 768 && (await exitFullscreen.isVisible()))
    await exitFullscreen.click()
  await panel.getByRole('button', { name: 'Collapse right sidebar', exact: true }).click()
  await expect(panel).not.toHaveAttribute('data-sidebar-right-open')
}

async function openFiles(app) {
  await app.getByRole('button', { name: 'Open right sidebar', exact: true }).click()
  const panel = foregroundSidebar(app)
  await expect(panel).toHaveAttribute('data-sidebar-right-open', 'true')
  const files = panel.getByText('Files', { exact: true })
  if (!(await files.isVisible()))
    await panel.getByRole('button', { name: /^Workspace files/ }).click()
  await expect(files).toBeVisible()
  return panel
}

async function followSessionEnvironment(app) {
  await openSeededSession(app)
  await closeSidebar(app)
  const card = app.getByRole('region', { name: 'Session environment', exact: true })
  await expect(card).toBeVisible()
  await expect(card.getByRole('button', { name: /^Copy CWD: .*\/workspace$/ })).toBeVisible()
  // These disposable directories are intentionally not Git repositories. This
  // result proves the real Remote codec and host Shell.execute/result path,
  // rather than accepting a UI-only loading or unavailable placeholder.
  await expect(card.getByText('Not a Git repository', { exact: true })).toBeVisible()
  await app
    .getByRole('tree', { name: 'Sessions', exact: true })
    .getByRole('treeitem', { name: new RegExp(`^${githubFieldWorkspaceName}\\s`) })
    .click()
  await closeSidebar(app)
  await expect(
    card.getByRole('button', { name: new RegExp(`^Copy CWD: .*/${githubFieldWorkspaceName}$`) }),
  ).toBeVisible()
  await expect(card.getByText('Not a Git repository', { exact: true })).toBeVisible()
  await expect(card.getByRole('button', { name: /^Copy CWD: .*\/workspace$/ })).toHaveCount(0)
}

async function visitGlobalPages(app) {
  await openSeededSession(app)
  await closeSidebar(app)
  const card = environmentCard(app)
  try {
    for (const page of ['Projects', 'Plugins']) {
      await expect(card).toBeVisible()
      await app.getByRole('button', { name: page, exact: true }).click()
      await expect(card).toHaveCount(0)
      await openSeededSession(app)
      await expect(card).toBeVisible()
    }
    // Every non-Chat session tab hides the card, not just global pages.
    const tabs = app.locator('[data-conversation-tabs] [role="tab"]')
    const labels = await tabs.allTextContents()
    expect(labels).toContain('Trajectory')
    for (const label of labels.filter((label) => label !== 'Chat')) {
      await app.getByRole('tab', { name: label, exact: true }).click()
      await expect(card).toBeHidden()
      if (label === 'Trajectory') {
        await app.reload()
        await expect(app.getByRole('tab', { name: label, exact: true })).toHaveAttribute(
          'aria-selected',
          'true',
        )
        await expect(card).toBeHidden()
      }
      await app.getByRole('tab', { name: 'Chat', exact: true }).click()
      await expect(card).toBeVisible()
    }
  } finally {
    const chat = app.getByRole('tab', { name: 'Chat', exact: true })
    if (await chat.isVisible()) await chat.click()
    await openSeededSession(app)
  }
}

async function browseFilesAndRestoreFullscreen(app) {
  await openSeededSession(app)
  await closeSidebar(app)
  const card = environmentCard(app)
  try {
    await expect(card).toBeVisible()
    await expect(card).toHaveCSS('position', 'fixed')
    await expect(card).toHaveCSS('top', '84px')
    await expect(card).toHaveCSS('right', '18px')
    for (const label of ['CWD', 'Branch', 'Sync', 'Changes'])
      await expect(card.getByText(label, { exact: true })).toBeVisible()

    const openedPanel = await openFiles(app)
    const firstSessionId = await openedPanel.getAttribute('data-sidebar-right-session')
    const firstPanel = app.locator(
      `[data-sidebar-right-panel][data-sidebar-right-session="${firstSessionId}"]`,
    )
    await expect(firstPanel).toHaveAttribute('data-sidebar-right-panel', 'push')
    await expect(card).toHaveCount(1)
    await expect(card).toBeHidden()
    await app
      .getByRole('tree', { name: 'Sessions', exact: true })
      .getByRole('treeitem', { name: new RegExp(`^${githubFieldWorkspaceName}\\s`) })
      .click()
    await closeSidebar(app)
    // The previous Files panel is no longer foreground; DSH may unmount it.
    await expect(firstPanel).toBeHidden()
    await expect(card).toBeVisible()
    await expect(
      card.getByRole('button', { name: new RegExp(`^Copy CWD: .*/${githubFieldWorkspaceName}$`) }),
    ).toBeVisible()
    await openSeededSession(app)
    await expect(card).toBeHidden()
    await closeSidebar(app)
    await expect(card).toBeVisible()

    const panel = await openFiles(app)
    await panel.getByRole('button', { name: 'Fullscreen', exact: true }).click()
    await expect(panel).toHaveAttribute('data-sidebar-right-panel', 'fullscreen')
    await expect(card).toBeHidden()
    await app.reload()
    // A restored fullscreen sidebar does not show the main-view setup prompt.
    await expect(foregroundSidebar(app)).toHaveAttribute('data-sidebar-right-panel', 'fullscreen')
    await expect(foregroundSidebar(app)).toHaveAttribute('data-sidebar-right-open', 'true')
    await expect(card).toBeHidden()
    await closeSidebar(app)
    await expect(card).toBeVisible()
  } finally {
    await closeSidebar(app)
    await openSeededSession(app)
    await closeSidebar(app)
  }
}

async function browseNarrowFiles(app) {
  await openSeededSession(app)
  await closeSidebar(app)
  await app.setViewportSize({ width: 640, height: 850 })
  const card = environmentCard(app)
  try {
    await expect(card).toBeVisible()
    const panel = await openFiles(app)
    await expect(panel).toHaveAttribute('data-sidebar-right-panel', 'fullscreen')
    await expect(app.locator('[data-rightbar-fullscreen]')).toHaveAttribute(
      'data-rightbar-collapsed',
      'true',
    )
    await expect(card).toBeHidden()
    await closeSidebar(app)
    await expect(card).toBeVisible()
  } finally {
    await closeSidebar(app)
    await app.setViewportSize({ width: 1100, height: 850 })
  }
}

test('follow native session environment through global pages, Files and restored fullscreen', async ({
  app,
}, testInfo) => {
  try {
    await test.step('Real Remote and Shell follow the retained session CWD', () =>
      followSessionEnvironment(app))
    await test.step('Live CI mounts through real Remote, managed Shell and fixture gh', async () => {
      await app
        .getByRole('tree', { name: 'Sessions', exact: true })
        .getByRole('treeitem', { name: new RegExp(`^${environmentCIWorkspace}\\s`) })
        .click()
      await closeSidebar(app)
      await expect(app.getByText(environmentCIPrompt, { exact: true })).toBeVisible()
      const card = environmentCard(app)
      await expect(card.getByText('PR #42', { exact: true })).toBeVisible()
      await expect(card.getByText('Default · trunk', { exact: true })).toBeVisible()
      await expect(card.getByText('running', { exact: true })).toBeVisible()
      await expect(card.getByText('success', { exact: true })).toBeVisible()
      await expect(
        card.getByText('Local HEAD differs · checks cover remote code', { exact: true }),
      ).toBeVisible()
      await expect(
        card.getByRole('link', { name: 'PR #42 checks at aaaaaaa', exact: true }),
      ).toHaveAttribute('href', 'https://github.com/ci-fixture/repo/pull/42/checks')
      await expect(
        card.getByRole('link', { name: 'Default · trunk checks at bbbbbbb', exact: true }),
      ).toHaveAttribute(
        'href',
        `https://github.com/ci-fixture/repo/commit/${'b'.repeat(40)}/checks`,
      )
      await expect(card).toContainText(/\d+s ago/)
      const screenshot = testInfo.outputPath('environment-live-ci.png')
      await card.screenshot({ path: screenshot })
      await testInfo.attach('Live checkout CI (isolated shell, fixture GitHub)', {
        path: screenshot,
        contentType: 'image/png',
      })
      await openFiles(app)
      await expect(card).toBeHidden()
      await closeSidebar(app)
      await expect(card).toBeVisible()
    })
    await test.step('Only Chat shows the card across global pages, tabs and reload', () =>
      visitGlobalPages(app))
    await test.step('Foreground Files, session switching and fullscreen reload', () =>
      browseFilesAndRestoreFullscreen(app))
    await test.step('Narrow Files has no reserved right track and closing restores the card', () =>
      browseNarrowFiles(app))
  } finally {
    await closeSidebar(app)
    await app.setViewportSize({ width: 1100, height: 850 })
    await openSeededSession(app)
    const chat = app.getByRole('tab', { name: 'Chat', exact: true })
    if (await chat.isVisible()) await chat.click()
    await closeSidebar(app)
  }
})
