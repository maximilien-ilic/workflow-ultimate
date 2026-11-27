import { execFile, execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { promisify } from 'node:util'
import { _electron, expect, test, type Page } from '@playwright/test'
import axe from 'axe-core'

const exec = promisify(execFile)

async function audit(page: Page, view: string, selector?: string) {
  await page.evaluate((source) => (0, eval)(source), axe.source)
  const violations = await page.evaluate(async (context) => {
    const { violations } = await (window as Window & { axe: typeof axe }).axe.run(context ?? document)
    return violations
      .filter(({ impact, id }) => impact === 'serious' || impact === 'critical' || id === 'color-contrast')
      .map(({ id, nodes }) => ({ id, elements: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) }))
  }, selector)
  expect.soft(violations, view).toEqual([])
}

for (const theme of ['dark', 'light'] as const) {
  test(`les vues Electron respectent les règles d’accessibilité en thème ${theme}`, async () => {
    const info = test.info()
    const repo = info.outputPath('projet')
    const config = info.outputPath('config')
    const orca = join(config, 'orca/profiles/test')
    mkdirSync(repo, { recursive: true })
    mkdirSync(orca, { recursive: true })
    mkdirSync(join(config, 'workflow-ultimate'), { recursive: true })
    writeFileSync(join(config, 'workflow-ultimate/settings.json'), JSON.stringify({ orcaImport: { seen: true } }))
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo })
    git('init', '-qb', 'main')
    writeFileSync(join(repo, 'exemple.txt'), 'ancienne ligne\n')
    git('add', 'exemple.txt')
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'base')
    writeFileSync(join(repo, 'exemple.txt'), 'nouvelle ligne\n')
    using source = new DatabaseSync(join(orca, 'profile-state.db'))
    source.exec('CREATE TABLE profile_state_documents (domain TEXT PRIMARY KEY, payload TEXT)')
    source.prepare('INSERT INTO profile_state_documents VALUES (?, ?)').run(
      'repos', JSON.stringify([{ path: repo, id: 'audit', kind: 'git' }]),
    )

    const args = ['out/main/index.js', `--user-data-dir=${info.outputPath('profile')}`]
    const env = {
      ...process.env,
      XDG_DATA_HOME: info.outputPath('data'), XDG_CONFIG_HOME: config,
      WU_CLAUDE_BIN: resolve('tests/fixtures/fake-agent'), FAKE_AGENT_SCENARIO: 'question',
    }
    const app = await _electron.launch({ args, env })
    try {
      const page = await app.firstWindow()
      const project = await page.evaluate((path) => window.wu.invoke('projects:add', { path }), repo)
      await page.reload()
      if (theme === 'light') await page.getByRole('button', { name: 'Thème clair', exact: true }).click()
      await expect(page.locator('html')).toHaveCSS('color-scheme', theme)
      await page.getByRole('treeitem', { name: 'main', exact: true }).click()
      await expect(page.getByRole('region', { name: 'Pull request' })).toBeVisible()
      await audit(page, 'Projet, barre latérale et panneau de contexte')
      await page.getByRole('button', { name: 'Claude dans projet' }).click()
      await expect(page.getByRole('tab', { name: /Claude · projet/ })).toContainText('attend une réponse')
      await audit(page, 'Onglets, agent et terminal')

      async function checkDialog(name: string, open: () => Promise<void>, ready?: () => Promise<unknown>) {
        await open()
        const dialog = page.getByRole('dialog', { name, exact: true })
        await expect(dialog).toBeVisible()
        await ready?.()
        await audit(page, name, 'dialog[open]')
        await page.keyboard.press('Escape')
        await expect(dialog).toBeHidden()
      }

      const press = (key: string) => () => page.keyboard.press(key)
      const command = (label: string) => async () => {
        await page.getByRole('button', { name: /^Commandes/ }).click()
        const search = page.getByRole('combobox', { name: 'Rechercher une commande' })
        await search.fill(label)
        await search.press('Enter')
      }

      await checkDialog('Palette de commandes', press('Control+Shift+P'))
      await checkDialog('Projets et worktrees', press('Control+Shift+O'))
      await checkDialog('Vue d’ensemble des agents', press('Control+Shift+A'))
      await checkDialog('Diff du worktree', press('Control+Shift+G'), async () => {
        await expect(page.getByRole('textbox', { name: 'Commentaire', exact: true })).toBeVisible()
        await audit(page, 'Diff côte à côte', 'dialog[open]')
        await page.getByRole('button', { name: 'En ligne', exact: true }).click()
      })
      await page.evaluate((projectId) => window.wu.invoke('tasks:create', { projectId, title: 'Relire le diff', body: '' }), project.id)
      await checkDialog('Tableau de tâches', press('Control+Shift+K'), () =>
        expect(page.getByText('Relire le diff', { exact: true })).toBeVisible())
      await checkDialog('Retirer le projet projet', () =>
        page.getByRole('button', { name: 'Retirer projet', exact: true }).click())
      await checkDialog('Diagnostic', command('Diagnostic'), () =>
        expect(page.getByRole('button', { name: 'Copier le rapport' })).toBeEnabled())
      await checkDialog('Importer depuis Orca', command('Réimporter depuis Orca'), () =>
        expect(page.getByRole('checkbox', { name: 'projet', exact: true })).toBeVisible())

      const executable = await app.evaluate(() => process.execPath)
      const [launcher] = await Promise.all([
        app.waitForEvent('window'),
        // shortcut: le runner Ubuntu de la CI ne peut pas initialiser le sandbox Chromium.
        exec(executable, [...(process.env.CI ? ['--no-sandbox'] : []), ...args, '--action', 'agents.quick-launch'], {
          env, timeout: 5_000,
        }),
      ])
      await expect(launcher.getByRole('textbox', { name: 'Prompt' })).toBeVisible()
      await expect(launcher.locator('html')).toHaveCSS('color-scheme', theme)
      await audit(launcher, 'Lanceur rapide')
    } finally {
      await app.close()
    }
  })
}
