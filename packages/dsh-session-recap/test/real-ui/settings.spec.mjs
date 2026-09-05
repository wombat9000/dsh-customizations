import { test, expect, pluginSettings } from '../../../../tests/real-ui/fixtures.mjs'

async function cardMetrics(header) {
  return header.evaluate((button) => {
    const pick = (element, keys) => {
      const style = getComputedStyle(element)
      return Object.fromEntries(keys.map((key) => [key, style[key]]))
    }
    const heading = button.firstElementChild
    const text = ['fontSize', 'fontWeight', 'lineHeight', 'color']
    return {
      card: pick(button.parentElement, ['backgroundColor', 'borderColor', 'borderWidth', 'borderRadius']),
      header: pick(button, ['padding', 'borderRadius', 'gap', 'alignItems']),
      heading: pick(heading, ['display', 'flexDirection', 'gap', 'minWidth']),
      title: pick(heading.firstElementChild, text),
      description: pick(heading.lastElementChild, text),
      chevron: pick(button.querySelector('svg'), ['width', 'height', 'color']),
    }
  })
}

async function focusMetrics(header) {
  return header.evaluate((button) => {
    const style = getComputedStyle(button)
    return [style.outlineStyle, style.outlineWidth, style.outlineColor, style.outlineOffset]
  })
}

for (const scheme of ['light', 'dark']) {
  test(`real plugin settings in ${scheme} mode`, async ({ app }) => {
    const dialog = await pluginSettings(app, scheme)
    const recap = dialog.getByRole('button', { name: 'Expand: Session recap', exact: true })
    const shell = dialog.getByRole('button', { name: 'Show settings: Shell', exact: true })
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0)
    expect(await cardMetrics(recap)).toEqual(await cardMetrics(shell))
    // Capture resting states before exercising hover/focus and neighboring cards.
    await expect(dialog).toHaveScreenshot(`settings-${scheme}-collapsed.png`)
    await recap.click()
    await expect(dialog.getByLabel('Provider ID')).toHaveValue('')
    await expect(dialog.getByLabel('Model ID')).toHaveValue('')
    await expect(dialog.getByLabel('Automatic recap on return')).toBeChecked()
    await expect(dialog.getByLabel('Inactivity (minutes)')).toHaveValue('30')
    await dialog.getByRole('heading', { name: 'Plugins', exact: true }).click()
    await expect(dialog).toHaveScreenshot(`settings-${scheme}-expanded.png`)

    await shell.click()
    const openedRecap = dialog.getByRole('button', { name: 'Collapse: Session recap', exact: true })
    const openedShell = dialog.getByRole('button', { name: 'Hide settings: Shell', exact: true })
    await expect(async () => {
      expect((await cardMetrics(openedRecap)).card).toEqual((await cardMetrics(openedShell)).card)
    }).toPass({ timeout: 5000 })
    await openedShell.click()
    await openedRecap.click()
    await expect(dialog.getByLabel('Provider ID')).toHaveCount(0)

    await recap.hover()
    await recap.evaluate(async (button) => { await Promise.all(button.parentElement.getAnimations().map((animation) => animation.finished)) })
    const hoverBorder = (await cardMetrics(recap)).card.borderColor
    await shell.hover()
    await expect.poll(async () => (await cardMetrics(shell)).card.borderColor).toBe(hoverBorder)
    await recap.press('Tab')
    await app.keyboard.press('Shift+Tab')
    await expect(recap).toBeFocused()
    await expect(recap).toHaveCSS('outline-style', 'solid')
    const focus = await focusMetrics(recap)
    await shell.focus()
    expect(await focusMetrics(shell)).toEqual(focus)
  })
}
