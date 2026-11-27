import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron, expect, test } from '@playwright/test'

let dir: string
test.beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'wu-e2e-')))
})
test.afterEach(() => rmSync(dir, { recursive: true, force: true }))

// Config et données isolées : jamais la vraie config de l'utilisateur, et pas de collision
// avec le verrou d'instance unique des autres tests lancés en parallèle.
const launch = () =>
  _electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, XDG_DATA_HOME: join(dir, 'data'), XDG_CONFIG_HOME: join(dir, 'config') },
  })

test('un projet ajouté survit au redémarrage, puis se retire', async () => {
  const repo = join(dir, 'mon-repo')
  mkdirSync(repo)
  execFileSync('git', ['init', '-q', repo])

  let app = await launch()
  let window = await app.firstWindow()
  await window.evaluate((path) => window.wu.invoke('projects:add', { path }), repo)
  await window.reload()
  await expect(window.getByRole('tree', { name: 'Projets et worktrees' })).toContainText('mon-repo')
  await app.close()

  app = await launch()
  window = await app.firstWindow()
  const list = window.getByRole('tree', { name: 'Projets et worktrees' })
  await expect(list).toContainText('mon-repo')
  await window.getByRole('button', { name: 'Retirer mon-repo' }).click()
  await expect(window.getByText('Aucun projet.')).toBeVisible()
  await app.close()
})

test('un dépôt déplacé se retire au clavier sans retirer les autres projets', async () => {
  const moved = join(dir, 'depot-deplace')
  const other = join(dir, 'autre-depot')
  for (const repo of [moved, other]) execFileSync('git', ['init', '-q', repo])

  const app = await launch()
  try {
    const window = await app.firstWindow()
    for (const repo of [moved, other]) {
      await window.evaluate((path) => window.wu.invoke('projects:add', { path }), repo)
    }
    renameSync(moved, join(dir, 'nouvel-emplacement'))
    await window.reload()

    const tree = window.getByRole('tree', { name: 'Projets et worktrees' })
    const project = tree.getByRole('treeitem', { name: 'depot-deplace' })
    const otherProject = tree.getByRole('treeitem', { name: 'autre-depot' })
    await expect(window.getByRole('alert').filter({ hasText: 'depot-deplace' })).toBeVisible()
    await expect(otherProject).toBeVisible()

    const remove = window.getByRole('button', { name: 'Retirer depot-deplace' })
    await expect(remove).toBeVisible()
    await project.press('Tab')
    await expect(remove).toBeFocused()
    await window.keyboard.press('Enter')
    await expect(project).toHaveCount(0)
    await expect(otherProject).toBeVisible()
    expect(await window.evaluate(() => window.wu.invoke('projects:list', {}))).toEqual([
      expect.objectContaining({ path: other }),
    ])
  } finally {
    await app.close()
  }
})

test("un dossier qui n'est pas un dépôt git est refusé avec un message clair", async () => {
  const plain = join(dir, 'pas-git')
  mkdirSync(plain)
  const app = await launch()
  const window = await app.firstWindow()
  const error = await window.evaluate(
    (path) =>
      window.wu.invoke('projects:add', { path }).then(
        () => 'accepté',
        (e: Error) => e.message,
      ),
    plain,
  )
  expect(error).toContain("n'est pas un dépôt git")
  await app.close()
})
