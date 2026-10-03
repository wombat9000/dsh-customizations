import { test as base, expect } from '@playwright/test'
export { openSeededSession } from './session-navigation.mjs'

export const test = base.extend({
  app: async ({ page, context }, use) => {
    const origin = new URL(process.env.DSH_TEST_URL).origin
    await context.route('**/*', (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
    )
    await context.addCookies([JSON.parse(process.env.DSH_TEST_COOKIE)])
    await page.goto(process.env.DSH_TEST_URL)
    await dismissOnboarding(page)
    await use(page)
  },
})
export { expect }

// The unconfigured-provider dialog returns after a real page reload. Reuse the
// same native dismissal for startup and persistence journeys; never configure
// a provider or bypass the dialog by mutating page/host state.
export async function dismissOnboarding(page) {
  const notice = page.getByRole('button', { name: 'Continue', exact: true })
  const configureLater = page.getByRole('button', { name: 'Configure later', exact: true })
  await expect(notice.or(configureLater)).toBeVisible()
  if (await notice.isVisible()) await notice.click()
  await configureLater.click()
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible()
}

export async function expandTurnProcesses(page) {
  // Target DSH folds completed tool steps by default. Exercise the native
  // disclosure instead of forcing DOM/CSS or changing user preferences.
  await expect(page.locator('[data-turn-process]').first()).toBeVisible()
  const collapsed = page.locator('[data-turn-process][aria-expanded="false"]:enabled')
  while (await collapsed.count()) await collapsed.first().click()
  const steps = page.locator('[data-process-activity][aria-expanded="false"]:visible')
  while (await steps.count()) await steps.first().click()
}

export async function setTheme(page, scheme, unfoldedWork = false) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'General', exact: true }).click()
  const choice = page.getByRole('button', {
    name: scheme === 'dark' ? 'Dark' : 'Light',
    exact: true,
  })
  if ((await choice.getAttribute('aria-pressed')) !== 'true') {
    // DSH applies Appearance optimistically. Await the real Settings acceptance
    // so a previous host snapshot cannot revert a later journey checkpoint.
    const accepted = page.waitForResponse(async (response) => {
      if (response.request().method() !== 'POST') return false
      try {
        const { result } = await response.json()
        return (
          result?.ok === true &&
          result.value?.ns === 'ui-theme' &&
          result.value.value?.preference === scheme
        )
      } catch {
        return false
      }
    })
    await Promise.all([accepted, choice.click()])
  } else {
    await choice.click()
  }
  await expect(choice).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('html')).toHaveCSS('color-scheme', scheme)
  if (unfoldedWork) {
    // Full-card evidence uses the native Verbose presentation. Standard mode
    // intentionally limits completed step groups to a 400px scroll viewport.
    await page
      .getByText('Work details', { exact: true })
      .locator('../..')
      .getByRole('button')
      .click()
    await page.getByRole('menuitem', { name: 'Verbose', exact: true }).click()
  }
  await page
    .getByRole('dialog', { name: 'Settings', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .click()
}

export async function pluginSettings(
  page,
  scheme,
  packageName = '@wombat9000/dsh-session-recap',
  rowId = 'wombat9000-session-recap',
) {
  await setTheme(page, scheme)
  await page.getByRole('button', { name: 'Plugins', exact: true }).click()
  const panel = page.locator('[data-plugin-panel]')
  await expect(panel).toBeVisible()
  for (let depth = 0; depth < 2; depth++) {
    const back = panel.getByRole('button', { name: /^Back to/ }).first()
    if (!(await back.isVisible())) break
    await back.click()
  }
  // Package names and row IDs, not translated titles, bind configuration identity.
  await page
    .locator(`[data-plugin-package="${packageName}"]`)
    .getByRole('button', { name: /^View/ })
    .click()
  await page
    .locator(`[data-plugin-detail="${packageName}"] [data-plugin-row$="${rowId}"]`)
    .getByRole('button', { name: /^Configure/ })
    .click()
  const configuration = page.locator(`[data-plugin-row-detail="${packageName}#${rowId}"]`)
  await expect(configuration).toBeVisible()
  await documentReady(page)
  return configuration
}

async function documentReady(page) {
  await page.evaluate(() => document.fonts.ready)
}
