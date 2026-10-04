import { execFileSync } from 'node:child_process'
import { mkdir, writeFile, readFile, realpath, access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { devNull } from 'node:os'
import { test, expect, dismissOnboarding } from '../../../../tests/real-ui/fixtures.mjs'

const command = (cwd, ...args) =>
  execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: devNull,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
    },
  }).trim()

// Real native shell and controllers, isolated fixture repository and uploads.
// Never submit a prompt, configure credentials, or invoke a model/provider.
test('native draft handoff, directory flow, dirty archive consent and committed restoration', async ({
  app,
}, testInfo) => {
  test.setTimeout(90000)
  const errors = []
  let stage = 'initial'
  app.on('pageerror', (error) => errors.push(`${stage}: ${error.stack ?? error.message}`))
  const source = join(
    await realpath(resolve(process.env.DSH_TEST_WORKSPACE, '..')),
    'worktree-session-ui-source',
  )
  await mkdir(source)
  command(source, 'init', '-b', 'main')
  command(source, 'config', 'user.name', 'Fixture')
  command(source, 'config', 'user.email', 'fixture@example.invalid')
  await writeFile(join(source, '.gitignore'), '.dsh/\n')
  await writeFile(join(source, 'tracked.txt'), 'committed fixture data\n')
  command(source, 'add', '.')
  command(
    source,
    '-c',
    `core.hooksPath=${devNull}`,
    '-c',
    'commit.gpgSign=false',
    'commit',
    '-m',
    'fixture',
  )

  // First-use has no registered Workspace yet. The actual native chip opens
  // our picker, which retains the native directory-provider flow.
  await app.getByRole('button', { name: 'Choose workspace', exact: true }).click()
  const folder = app.getByRole('dialog', { name: 'Select Workspace Directory', exact: true })
  await expect(folder).toBeVisible()
  await folder.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(folder).toBeHidden()
  await app.getByRole('button', { name: 'Choose workspace', exact: true }).click()
  await folder.getByRole('button', { name: 'Edit path', exact: true }).click()
  const path = folder.getByRole('textbox', { name: 'Edit path', exact: true })
  await path.fill(source)
  await path.press('Enter')
  await expect(
    folder
      .getByRole('button', { name: 'worktree-session-ui-source', exact: true })
      .and(folder.locator('[aria-current="true"]')),
  ).toBeVisible()
  await folder.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(folder).toBeHidden()
  const checkbox = app.getByRole('checkbox', { name: 'Use worktree', exact: true })
  await expect(checkbox).toBeEnabled()
  await expect(checkbox).not.toBeChecked()
  const accessName = await app
    .getByRole('button', { name: /^Access mode, current:/ })
    .getAttribute('aria-label')
  const modelName = await app
    .getByRole('button', { name: /^Select model, current / })
    .getAttribute('aria-label')
  await app.getByRole('button', { name: 'Standard mode', exact: true }).click()
  await app.getByRole('menuitem', { name: /^Worktree coordinator / }).click()
  await expect(app.getByRole('button', { name: 'Worktree coordinator', exact: true })).toBeVisible()
  const editor = app.locator('[contenteditable="true"]').first()
  await editor.fill('Keep this draft and its fixture attachment.')
  const firstUpload = app.waitForResponse(
    (r) => r.url().includes('/api/session/uploadFileBinary') && r.status() === 200,
  )
  await app
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('fixture attachment'),
    })
  const uploaded = await firstUpload
  const sourceSession = new URL(uploaded.url()).searchParams.get('sessionId')
  await expect(app.getByText('notes.txt', { exact: true }).first()).toBeVisible()

  const creation = app.waitForResponse(
    (response) => new URL(response.url()).pathname === '/local-worktree-sessions/create',
  )
  const transferred = app
    .waitForResponse(
      (r) =>
        r.url().includes('/api/session/uploadFileBinary') &&
        r.status() === 200 &&
        new URL(r.url()).searchParams.get('sessionId') !== sourceSession,
    )
    .catch(() => null)
  await checkbox.check()
  const envelope = await (await creation).json()
  expect(envelope.result ?? envelope).toMatchObject({ ok: true })
  const record = (envelope.result ?? envelope).value
  expect(record.path).toBe(resolve(record.path))
  expect(await realpath(record.path)).toBe(record.path)
  expect(record.path).toMatch(new RegExp(`^${source}/\\.dsh/worktrees/session-[0-9a-f-]+$`))
  expect(record.path).not.toBe(source)
  expect(command(record.path, 'branch', '--show-current')).toBe(record.branch)
  expect(command(source, 'branch', '--show-current')).toBe('main')
  expect(new URL((await transferred).url()).searchParams.get('sessionId')).toBe(record.sessionId)
  await expect(checkbox).toBeChecked()
  await expect(app.getByRole('button', { name: 'Worktree coordinator', exact: true })).toBeVisible()
  await expect(app.getByRole('button', { name: /^Access mode, current:/ })).toHaveAttribute(
    'aria-label',
    accessName,
  )
  await expect(app.getByRole('button', { name: /^Select model, current / })).toHaveAttribute(
    'aria-label',
    modelName,
  )
  await expect(editor).toHaveText('Keep this draft and its fixture attachment.')
  await expect(app.getByText('notes.txt', { exact: true }).first()).toBeVisible()
  await app.evaluate(() => document.fonts.ready)
  await app.screenshot({
    path: testInfo.outputPath('isolated-session.png'),
    animations: 'disabled',
    caret: 'hide',
  })

  await writeFile(join(record.path, 'scratch.txt'), 'unsaved fixture file\n')
  await app.getByRole('button', { name: 'Session worktrees', exact: true }).click()
  const ledger = app.getByRole('region', { name: 'Session worktrees', exact: true })
  stage = 'archive'
  await ledger.getByRole('button', { name: 'Archive session', exact: true }).click()
  const confirmation = app.getByRole('dialog', {
    name: 'Remove archived session checkout?',
    exact: true,
  })
  await expect(confirmation).toBeVisible({ timeout: 15000 })
  await expect(confirmation.getByText('scratch.txt', { exact: true })).toBeVisible()
  await confirmation.getByRole('button', { name: 'Keep checkout', exact: true }).click()
  expect(await readFile(join(record.path, 'scratch.txt'), 'utf8')).toBe('unsaved fixture file\n')
  // Native archive clears the selected Session and returns to the empty Hero.
  await app.getByRole('button', { name: 'Session worktrees', exact: true }).click()
  await ledger.getByRole('button', { name: 'Review cleanup', exact: true }).click()
  await expect(confirmation).toBeVisible()
  await app.screenshot({
    path: testInfo.outputPath('dirty-archive-consent.png'),
    animations: 'disabled',
    caret: 'hide',
  })
  await confirmation
    .getByRole('button', { name: 'Discard files and remove checkout', exact: true })
    .click()
  await expect(confirmation).toBeHidden()
  await expect
    .poll(async () => {
      try {
        await access(record.path)
        return true
      } catch {
        return false
      }
    })
    .toBe(false)
  expect(command(source, 'branch', '--list', record.branch)).toBe('')
  stage = 'restore'
  await ledger.getByRole('button', { name: 'Restore and open', exact: true }).click()
  await expect(checkbox).toBeChecked()
  expect(await readFile(join(record.path, 'tracked.txt'), 'utf8')).toBe('committed fixture data\n')
  await expect
    .poll(async () => {
      try {
        await access(join(record.path, 'scratch.txt'))
        return true
      } catch {
        return false
      }
    })
    .toBe(false)
  await app.reload()
  await dismissOnboarding(app)
  await expect(checkbox).toBeChecked()
  await app.getByRole('button', { name: 'Session worktrees', exact: true }).click()
  stage = 'archive'
  await ledger.getByRole('button', { name: 'Archive session', exact: true }).click()
  await expect
    .poll(
      async () => {
        try {
          await access(record.path)
          return true
        } catch {
          return false
        }
      },
      { timeout: 15000 },
    )
    .toBe(false)
  expect(errors).toEqual([])
})
