import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron, expect, test } from '@playwright/test'

async function launchWithProject(dir: string) {
  const repo = join(dir, 'proj')
  mkdirSync(repo)
  execFileSync('git', ['init', '-q', repo])
  const app = await _electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, XDG_DATA_HOME: join(dir, 'data'), XDG_CONFIG_HOME: join(dir, 'config') },
  })
  const page = await app.firstWindow()
  await page.evaluate((path) => window.wu.invoke('projects:add', { path }), repo)
  await page.reload()
  await expect(page.getByRole('treeitem', { selected: true })).toBeVisible()
  return { app, page }
}

test('les colonnes sont côte à côte et le focus reste sur la carte', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'wu-e2e-tasks-focus-')))
  const { app, page } = await launchWithProject(dir)
  try {
    const board = page.getByRole('dialog', { name: 'Tableau de tâches' })
    const column = (name: string) => board.getByRole('region', { name, exact: true })
    await page.keyboard.press('Control+Shift+K')
    await page.keyboard.type('Carte')
    await page.keyboard.press('Enter')
    const [todo, done] = await Promise.all([column('À faire').boundingBox(), column('Fini').boundingBox()])
    expect(done!.y).toBe(todo!.y)
    expect(done!.x).toBeGreaterThan(todo!.x)

    const edit = board.getByRole('button', { name: 'Éditer « Carte »' })
    await edit.focus()
    await page.keyboard.press('Enter')
    await board.getByRole('button', { name: 'Annuler' }).focus()
    await page.keyboard.press('Enter')
    await expect(edit).toBeFocused()

    for (const target of ['En cours', 'En revue', 'Fini']) {
      await board.getByRole('button', { name: `Déplacer « Carte » vers ${target}` }).focus()
      await page.keyboard.press('Enter')
      await expect(column(target)).toContainText('Carte')
    }
    await expect(edit).toBeFocused()
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('créer, éditer et déplacer une tâche sans la souris', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'wu-e2e-tasks-')))
  const { app, page } = await launchWithProject(dir)
  try {
    const board = page.getByRole('dialog', { name: 'Tableau de tâches' })
    const column = (name: string) => board.getByRole('region', { name, exact: true })
    // Le tableau suit le projet sélectionné : attendre que la sélection soit restaurée.
    const projectSelected = () =>
      expect(page.getByRole('treeitem', { selected: true })).toBeVisible()

    await page.keyboard.press('Control+Shift+K')
    await expect(board.getByLabel('Nouvelle tâche')).toBeFocused()
    await page.keyboard.type('Écrire le test')
    await page.keyboard.press('Enter')
    await expect(column('À faire')).toContainText('Écrire le test')

    await page.keyboard.press('Tab') // Ajouter
    await page.keyboard.press('Tab') // Éditer
    await page.keyboard.press('Tab')
    await expect(board.getByRole('button', { name: 'Déplacer « Écrire le test » vers En cours' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(column('En cours')).toContainText('Écrire le test')
    await page.keyboard.press('Enter')
    await expect(column('En revue')).toContainText('Écrire le test')

    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Enter')
    await expect(board.getByLabel('Titre de la tâche')).toBeFocused()
    await page.keyboard.press('Control+A')
    await page.keyboard.type('Test écrit')
    await page.keyboard.press('Enter')
    await expect(column('En revue')).toContainText('Test écrit')

    await page.reload()
    await projectSelected()
    await page.keyboard.press('Control+Shift+K')
    await expect(column('En revue')).toContainText('Test écrit')
    await expect(column('À faire').getByRole('listitem')).toHaveCount(0)
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
