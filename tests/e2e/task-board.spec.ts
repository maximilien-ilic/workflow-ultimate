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
    const editThenCancel = async () => {
      await edit.focus()
      await page.keyboard.press('Enter')
      await board.getByRole('button', { name: 'Annuler' }).focus()
      await page.keyboard.press('Enter')
      await expect(edit).toBeFocused()
    }
    await editThenCancel()

    // Après un déplacement vers une colonne intermédiaire, fermer l'éditeur rend aussi le focus à « Éditer ».
    await board.getByRole('button', { name: 'Déplacer « Carte » vers En cours' }).focus()
    await page.keyboard.press('Enter')
    await expect(column('En cours')).toContainText('Carte')
    await editThenCancel()

    for (const target of ['En revue', 'Fini']) {
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
    await page.keyboard.press('Tab') // Importer les issues GitHub
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

test('corriger un titre refusé à la création sans perdre la saisie', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'wu-e2e-tasks-create-')))
  const { app, page } = await launchWithProject(dir)
  try {
    const board = page.getByRole('dialog', { name: 'Tableau de tâches' })
    const todo = board.getByRole('region', { name: 'À faire', exact: true })
    const title = board.getByRole('textbox', { name: 'Nouvelle tâche' })
    const invalidTitle = 'A'.repeat(257)

    await page.keyboard.press('Control+Shift+K')
    await title.fill(invalidTitle)
    await title.press('Enter')
    await expect(board.getByRole('alert')).toContainText('tasks:create')
    await expect(title).toHaveValue(invalidTitle)
    await expect(title).toBeFocused()
    await expect(todo.getByRole('listitem')).toHaveCount(0)

    await page.keyboard.press('End')
    await page.keyboard.press('Backspace')
    // Deux activations dans le même tour garantissent que la seconde précède la réponse IPC.
    await board.getByRole('button', { name: 'Ajouter' }).evaluate((button: HTMLButtonElement) => {
      button.click()
      button.click()
    })
    await expect(todo.getByText(invalidTitle.slice(1), { exact: true })).toBeVisible()
    await expect(title).toHaveValue('')
    await expect(title).toBeFocused()
    await expect(board.getByRole('alert')).toBeHidden()

    await page.reload()
    await expect(page.getByRole('treeitem', { selected: true })).toBeVisible()
    await page.keyboard.press('Control+Shift+K')
    await expect(todo.getByRole('listitem')).toHaveCount(1)
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('corriger une description refusée en gardant les deux champs et le focus', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'wu-e2e-tasks-update-')))
  const { app, page } = await launchWithProject(dir)
  try {
    const board = page.getByRole('dialog', { name: 'Tableau de tâches' })
    const newTitle = board.getByRole('textbox', { name: 'Nouvelle tâche' })
    const title = board.getByRole('textbox', { name: 'Titre de la tâche' })
    const body = board.getByRole('textbox', { name: 'Description de la tâche' })
    const invalidBody = 'B'.repeat(20_001)

    await page.keyboard.press('Control+Shift+K')
    await newTitle.fill('Carte')
    await newTitle.press('Enter')
    await board.getByRole('button', { name: 'Éditer « Carte »' }).press('Enter')
    await title.fill('Carte corrigée')
    await body.fill(invalidBody)
    await page.keyboard.press('Tab')
    const save = board.getByRole('button', { name: 'Enregistrer' })
    await expect(save).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(board.getByRole('alert')).toContainText('tasks:update')
    await expect(title).toHaveValue('Carte corrigée')
    await expect(body).toHaveValue(invalidBody)
    await expect(save).toBeFocused()

    await page.keyboard.press('Shift+Tab')
    await expect(body).toBeFocused()
    await page.keyboard.press('Control+End')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    await expect(board.getByRole('button', { name: 'Éditer « Carte corrigée »' })).toBeFocused()
    await expect(title).toBeHidden()
    await expect(board.getByText(invalidBody.slice(1), { exact: true })).toBeVisible()
    await expect(board.getByRole('alert')).toBeHidden()

    await page.keyboard.press('Enter')
    await title.fill('Carte finale')
    // Le focus quitte l'éditeur avant que le processus principal puisse répondre.
    await newTitle.evaluate((input: HTMLInputElement) => {
      (document.activeElement as HTMLInputElement).form!.requestSubmit()
      input.focus()
    })
    await expect(board.getByRole('button', { name: 'Éditer « Carte finale »' })).toBeVisible()
    await expect(newTitle).toBeFocused()
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('les textes sans espaces restent dans leur colonne du Kanban', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'wu-e2e-tasks-overflow-')))
  const { app, page } = await launchWithProject(dir)
  try {
    const title = 'W'.repeat(256)
    const body = 'A'.repeat(1_000)
    await page.evaluate(async ({ title, body }) => {
      const [project] = await window.wu.invoke('projects:list', {})
      const projectId = project!.id
      await window.wu.invoke('tasks:create', { projectId, title, body })
      const tasks = await window.wu.invoke('tasks:create', { projectId, title: 'Carte voisine', body: '' })
      const neighbour = tasks.find(({ title }) => title === 'Carte voisine')!
      await window.wu.invoke('tasks:move', { projectId, id: neighbour.id, status: 'doing' })
    }, { title, body })
    await page.keyboard.press('Control+Shift+K')
    const board = page.getByRole('dialog', { name: 'Tableau de tâches' })
    const todo = board.getByRole('region', { name: 'À faire' })
    const doing = board.getByRole('region', { name: 'En cours' })
    await expect(doing).toContainText('Carte voisine')
    const adjacent = (await doing.boundingBox())!
    expect((await todo.boundingBox())!.y).toBe(adjacent.y)
    for (const text of [title, body]) {
      const right = await todo.getByText(text, { exact: true }).evaluate((element) => {
        const range = document.createRange()
        range.selectNodeContents(element)
        return range.getBoundingClientRect().right
      })
      expect(right).toBeLessThanOrEqual(adjacent.x)
    }
    expect(await board.evaluate((element) => element.scrollWidth)).toBe(
      await board.evaluate((element) => element.clientWidth),
    )
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('retrouve une tâche au clavier et distingue deux projets avec le même titre', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'wu-e2e-task-palette-')))
  const { app, page } = await launchWithProject(dir)
  try {
    const other = join(dir, 'second-projet')
    execFileSync('git', ['init', '-q', other])
    await page.evaluate(async (path) => {
      await window.wu.invoke('projects:add', { path })
      const projects = await window.wu.invoke('projects:list', {})
      for (const { id, name } of projects) await window.wu.invoke('tasks:create', {
        projectId: id, title: 'Dossier Zéphyr', body: `Détail pour ${name}`,
      })
    }, other)
    await page.reload()
    await expect(page.getByRole('treeitem', { name: 'second-projet', exact: true })).toBeVisible()
    await page.keyboard.press('Control+Shift+P')
    const palette = page.getByRole('dialog', { name: 'Palette de commandes' })
    const search = palette.getByRole('combobox')
    await search.fill('Zphyr')
    await expect(palette.getByRole('option', { name: 'Dossier Zéphyr · proj', exact: true })).toBeVisible()
    await expect(palette.getByRole('option', { name: 'Dossier Zéphyr · second-projet', exact: true })).toBeVisible()
    await search.fill('Zéphyr second-projet')
    await search.press('Enter')
    const board = page.getByRole('dialog', { name: 'Tableau de tâches' })
    await expect(board).toContainText('Détail pour second-projet')
    await expect(board.getByRole('button', { name: 'Éditer « Dossier Zéphyr »' })).toBeFocused()
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
