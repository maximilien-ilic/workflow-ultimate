import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron, expect, test, type Page } from '@playwright/test'

let dir: string
test.beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'wu-e2e-view-')))
})
test.afterEach(() => rmSync(dir, { recursive: true, force: true }))

// xterm dessine en WebGL (canvas) : on lit la sortie dans le tampon du pty-host.
const outputOf = (page: Page, id: string) =>
  page.evaluate((id) => window.wu.invoke('terminal:attach', { id }), id)

test('ouvrir un terminal, y taper, le découper, survivre au rechargement, fermer un volet', async () => {
  const repo = join(dir, 'mon-projet')
  mkdirSync(repo)
  execFileSync('git', ['init', '-q', repo])
  const app = await _electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, XDG_DATA_HOME: join(dir, 'data'), XDG_CONFIG_HOME: join(dir, 'config') },
  })
  const page = await app.firstWindow()
  await page.evaluate((path) => window.wu.invoke('projects:add', { path }), repo)
  await page.reload()

  await page.getByRole('button', { name: 'Terminal dans mon-projet' }).click()
  const hosts = page.locator('.terminal-host')
  await expect(hosts).toHaveCount(1)
  const first = (await hosts.first().getAttribute('data-terminal-id'))!
  await hosts.first().click()
  await page.keyboard.type('echo clavier-$((2*21))\n')
  await expect.poll(() => outputOf(page, first)).toContain('clavier-42')

  await page.keyboard.press('Control+Shift+D')
  await expect(hosts).toHaveCount(2)

  await page.reload()
  await expect(hosts).toHaveCount(2)
  await expect(page.locator(`[data-terminal-id="${first}"]`)).toBeVisible()
  await expect.poll(() => outputOf(page, first)).toContain('clavier-42')

  await page.locator(`[data-terminal-id="${first}"]`).click()
  await page.keyboard.press('Control+Shift+W')
  await expect(hosts).toHaveCount(1)
  await app.close()
})
