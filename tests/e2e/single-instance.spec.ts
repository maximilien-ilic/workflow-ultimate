import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { _electron, expect, test } from '@playwright/test'

const exec = promisify(execFile)

test('routes a second launch to the existing window', async () => {
  const testInfo = test.info()
  // shortcut: le runner Ubuntu de la CI ne peut pas initialiser le sandbox Chromium ; en local, le sandbox
  // reste actif (AGENTS.md). Retirer le flag quand le runner le pourra.
  const noSandbox = process.env['CI'] ? ['--no-sandbox'] : []
  const args = [...noSandbox, 'out/main/index.js', `--user-data-dir=${testInfo.outputPath('profile')}`]
  const env = {
    ...process.env,
    XDG_CONFIG_HOME: testInfo.outputPath('config'),
    XDG_DATA_HOME: testInfo.outputPath('data'),
  }
  const app = await _electron.launch({ args, env })

  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('heading', { name: 'Workflow Ultimate', exact: true })).toBeVisible()
    const window = await app.browserWindow(page)
    const hidden = await window.evaluate(async (win) => {
      if (!win.isVisible()) await new Promise<void>((resolve) => win.once('show', () => resolve()))
      win.hide()
      return !win.isVisible()
    })
    expect(hidden).toBe(true)

    const executable = await app.evaluate(() => process.execPath)
    await exec(executable, [...args, '--action', 'window.show'], { env, timeout: 5_000 })
    await expect.poll(() => window.evaluate((win) => win.isVisible())).toBe(true)
    expect(app.windows()).toEqual([page])
  } finally {
    await app.close()
  }
})
