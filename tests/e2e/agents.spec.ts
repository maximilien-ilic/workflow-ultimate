import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron, expect, test } from '@playwright/test'

let dir: string
test.beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'wu-e2e-agent-')))
})
test.afterEach(() => rmSync(dir, { recursive: true, force: true }))

test("un agent lancé depuis un projet remonte ses états jusqu'à l'onglet", async () => {
  const repo = join(dir, 'proj')
  mkdirSync(repo)
  execFileSync('git', ['init', '-q', repo])

  // Le faux agent remplace `claude` : mêmes événements que les vrais hooks, via wu-notify et le socket.
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
  await page.evaluate((path) => window.wu.invoke('projects:add', { path }), repo)
  await page.reload()

  await page.getByRole('button', { name: 'Claude dans proj' }).click()
  const tab = page.getByRole('tab', { name: /Claude · proj/ })
  await expect(tab).toContainText('attend une réponse')

  await page.locator('.terminal-host').first().click()
  await page.keyboard.type('oui\n')
  await expect(tab).toContainText('terminé')

  const sessions = await page.evaluate(() => window.wu.invoke('agents:list', {}))
  expect(sessions).toHaveLength(1)
  expect(sessions[0]).toMatchObject({ agent: 'claude-code', cwd: repo, state: 'done' })

  // En-tête de l'agent : état lisible, puis « Reprendre » une fois le processus terminé.
  const header = page.getByRole('region', { name: 'Agent Claude Code' })
  await expect(header.getByRole('status')).toHaveText(/terminé/)
  // Après un rechargement, l'en-tête restauré est réconcilié avec le main : l'agent est fini, donc « Reprendre ».
  await page.reload()
  await expect(header.getByRole('button', { name: 'Reprendre' })).toBeVisible()
  await expect(header.getByRole('button', { name: 'Interrompre' })).toHaveCount(0)
  await header.getByRole('button', { name: 'Reprendre' }).click()
  const resumed = page.getByRole('tab', { name: /\(reprise\)/ })
  await expect(resumed).toContainText('attend une réponse')
  await expect(page.getByRole('region', { name: 'Agent Claude Code' }).getByRole('status')).toHaveText(
    /attend une réponse/,
  )

  // Fermer l'onglet repris : il disparaît, et son agent est arrêté.
  await page
    .getByRole('region', { name: 'Agent Claude Code' })
    .getByRole('button', { name: 'Fermer' })
    .click()
  await expect(resumed).toHaveCount(0)
  await app.close()
})
