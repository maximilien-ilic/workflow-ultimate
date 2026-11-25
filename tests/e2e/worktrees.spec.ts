import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron, expect, test } from '@playwright/test'

let dir: string
test.beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'wu-e2e-wt-')))
})
test.afterEach(() => rmSync(dir, { recursive: true, force: true }))

test('créer un worktree, refuser sa suppression avec des changements, puis le supprimer', async () => {
  const repo = join(dir, 'app')
  mkdirSync(repo)
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo })
  git('init', '-q', '-b', 'main')
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init')

  // HOME temporaire : les worktrees vont dans ~/workflow-ultimate/workspaces, jamais dans le vrai HOME.
  const app = await _electron.launch({
    args: ['out/main/index.js'],
    env: {
      ...process.env,
      HOME: join(dir, 'home'),
      XDG_DATA_HOME: join(dir, 'data'),
      XDG_CONFIG_HOME: join(dir, 'config'),
    },
  })
  const page = await app.firstWindow()
  const project = await page.evaluate((path) => window.wu.invoke('projects:add', { path }), repo)
  await page.reload()
  const sidebar = page.getByRole('complementary', { name: 'Barre latérale' })
  const tree = sidebar.getByRole('tree', { name: 'Projets et worktrees' })
  const projectRow = tree.getByRole('treeitem', { name: 'app', exact: true })
  const main = tree.getByRole('treeitem', { name: 'main', exact: true })
  await projectRow.focus()
  await page.keyboard.press('ArrowRight')
  await expect(main).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(main).toHaveAttribute('aria-selected', 'true')

  await sidebar.getByRole('button', { name: 'Créer un worktree…' }).click()
  await sidebar.getByRole('textbox', { name: 'Branche' }).fill('feat/1-essai')
  await sidebar.getByRole('button', { name: 'Créer', exact: true }).click()
  const linked = tree.getByRole('treeitem', { name: 'feat/1-essai', exact: true })
  await expect(linked).toBeVisible()
  const path = join(dir, 'home/workflow-ultimate/workspaces/app/feat-1-essai')
  const list = await page.evaluate(
    (projectId) => window.wu.invoke('worktrees:list', { projectId }),
    project.id,
  )
  expect(list.map((w) => w.branch)).toEqual(['main', 'feat/1-essai'])

  writeFileSync(join(path, 'travail.txt'), 'x')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(linked).toContainText('1 non suivi')
  const refused = await page.evaluate(
    ({ projectId, path }) => window.wu.invoke('worktrees:remove', { projectId, path, force: false }),
    { projectId: project.id, path },
  )
  expect(refused).toEqual({ removed: false, dirtyFiles: 1 })
  expect(existsSync(path)).toBe(true)

  await linked.click()
  await sidebar.getByRole('button', { name: 'Supprimer le worktree' }).click()
  const confirmation = page.getByRole('dialog', { name: 'Supprimer le worktree' })
  await expect(confirmation).toContainText('1 fichier')
  await confirmation.getByRole('button', { name: 'Supprimer et perdre les modifications' }).click()
  await expect(linked).toHaveCount(0)
  expect(existsSync(path)).toBe(false)

  const outside = await page.evaluate(
    ({ projectId, path }) =>
      window.wu.invoke('worktrees:remove', { projectId, path, force: true }).then(
        () => 'supprimé',
        (e: Error) => e.message,
      ),
    { projectId: project.id, path: repo },
  )
  expect(outside).toContain('principal')
  await app.close()
})
