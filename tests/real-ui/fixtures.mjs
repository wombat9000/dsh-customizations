import { test as base, expect } from '@playwright/test'

export const test = base.extend({
  app: async ({ page, context }, use) => {
    const origin = new URL(process.env.DSH_TEST_URL).origin
    await context.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
    await context.addCookies([JSON.parse(process.env.DSH_TEST_COOKIE)])
    await page.goto(process.env.DSH_TEST_URL)
    const notice = page.getByRole('button', { name: 'Continue', exact: true })
    const configureLater = page.getByRole('button', { name: 'Configure later', exact: true })
    await expect(notice.or(configureLater)).toBeVisible()
    if (await notice.isVisible()) await notice.click()
    await configureLater.click()
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible()
    await use(page)
  },
})
export { expect }

export async function pluginSettings(page, scheme) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'General', exact: true }).click()
  await page.getByRole('button', { name: scheme === 'dark' ? 'Dark' : 'Light', exact: true }).click()
  await expect(page.locator('html')).toHaveCSS('color-scheme', scheme)
  await page.getByRole('button', { name: 'Plugins', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
  await expect(dialog.getByRole('button', { name: 'Expand: Session recap' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Show settings: Shell' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Show settings: Agent loop' })).toBeVisible()
  await documentReady(page)
  return dialog
}

async function documentReady(page) {
  await page.evaluate(() => document.fonts.ready)
}
