import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron, expect, test } from '@playwright/test'

let dir: string
test.beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'wu-e2e-overview-')))
})
test.afterEach(() => rmSync(dir, { recursive: true, force: true }))

test("vue d'ensemble : l'agent en attente en tête, et Ctrl+Shift+J y ramène", async () => {
  for (const name of ['alpha', 'beta']) {
    mkdirSync(join(dir, name))
    execFileSync('git', ['init', '-q', join(dir, name)])
  }
  const app = await _electron.launch({
    args: ['out/main/index.js'],
    env: {
      ...process.env,
      XDG_DATA_HOME: join(dir, 'data'),
      XDG_CONFIG_HOME: join(dir, 'config'),
      WU_CLAUDE_BIN: resolve('tests/fixtures/fake-agent'),
      FAKE_AGENT_SCENARIO: 'question',
    },
  })
  const page = await app.firstWindow()
  for (const name of ['alpha', 'beta'])
    await page.evaluate((path) => window.wu.invoke('projects:add', { path }), join(dir, name))
  await page.reload()

  await page.getByRole('button', { name: 'Claude dans alpha' }).click()
  await expect(page.getByRole('tab', { name: /Claude · alpha/ })).toContainText('attend une réponse')
  await page.getByRole('button', { name: 'Claude dans beta' }).click()
  const beta = page.getByRole('tab', { name: /Claude · beta/ })
  await expect(beta).toContainText('attend une réponse')

  // On répond à beta (onglet actif) : il termine, alpha reste en attente.
  await page.locator('.terminal-tab:not([hidden]) .terminal-host').click()
  await page.keyboard.type('oui\n')
  await expect(beta).toContainText('terminé')

  await page.keyboard.press('Control+Shift+A')
  const overview = page.getByRole('dialog', { name: 'Vue d’ensemble des agents' })
  await expect(overview).toBeVisible()
  const items = overview.getByRole('listitem')
  await expect(items.first()).toContainText('Claude · alpha — attend une réponse')
  await expect(items.first()).toContainText('Continuer ?') // aperçu des dernières lignes
  await expect(items.nth(1)).toContainText('terminé')
  await page.keyboard.press('Escape')

  // Depuis beta (terminé), Ctrl+Shift+J ramène à alpha, le seul agent en attente.
  await page.locator('.terminal-tab:not([hidden]) .terminal-host').click()
  await page.keyboard.press('Control+Shift+J')
  await expect(page.getByRole('tab', { name: /Claude · alpha/ })).toHaveAttribute('aria-selected', 'true')
  await app.close()
})
