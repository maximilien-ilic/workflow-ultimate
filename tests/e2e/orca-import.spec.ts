import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { _electron, expect, test } from '@playwright/test'

test('propose la sélection Orca au premier lancement et réutilise le dossier des workspaces', async () => {
  const testInfo = test.info()
  const config = testInfo.outputPath('config')
  const source = join(config, 'orca/profiles/default/profile-state.db')
  const repo = testInfo.outputPath('alpha')
  const other = testInfo.outputPath('beta')
  const linked = testInfo.outputPath('lié')
  const workspaceDir = testInfo.outputPath('workspaces')
  for (const path of [repo, other, join(config, 'orca/profiles/default')])
    mkdirSync(path, { recursive: true })
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd })
  for (const path of [repo, other]) {
    git(path, 'init', '-q', '-b', 'main')
    git(
      path,
      '-c',
      'user.name=test',
      '-c',
      'user.email=test@example.test',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'initial',
    )
  }
  git(repo, 'worktree', 'add', '-q', '-b', 'feature', linked)
  const fixture = new DatabaseSync(source)
  fixture.exec('CREATE TABLE profile_state_documents (domain TEXT PRIMARY KEY, payload TEXT)')
  const insert = fixture.prepare('INSERT INTO profile_state_documents VALUES (?, ?)')
  insert.run(
    'repos',
    JSON.stringify([
      { path: repo, id: 'alpha', kind: 'git' },
      { path: other, id: 'beta', kind: 'git' },
    ]),
  )
  insert.run(
    'worktreeMeta',
    JSON.stringify({
      ['alpha::' + linked]: { displayName: 'Lié existant' },
      ['alpha::' + testInfo.outputPath('absent')]: { displayName: 'Volet périmé' },
    }),
  )
  insert.run('settings', JSON.stringify({ workspaceDir }))
  fixture.close()
  const before = readFileSync(source)
  const launch = () =>
    _electron.launch({
      args: ['out/main/index.js', `--user-data-dir=${testInfo.outputPath('profile')}`],
      env: { ...process.env, XDG_CONFIG_HOME: config, XDG_DATA_HOME: testInfo.outputPath('data') },
    })

  const app = await launch()
  try {
    const page = await app.firstWindow()
    const dialog = page.getByRole('dialog', { name: 'Importer depuis Orca' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('checkbox', { name: 'Lié existant' })).toBeChecked()
    await expect(dialog.getByText('Volet périmé')).toHaveCount(0)
    await dialog.getByRole('checkbox', { name: 'beta', exact: true }).uncheck()
    await dialog.getByRole('button', { name: 'Importer', exact: true }).click()
    await expect(dialog).toBeHidden()
    const tree = page.getByRole('tree', { name: 'Projets et worktrees' })
    await expect(tree.getByRole('treeitem', { name: 'alpha', exact: true })).toHaveCount(1)
    await expect(tree.getByRole('treeitem', { name: 'beta', exact: true })).toHaveCount(0)
    const [project] = await page.evaluate(() => window.wu.invoke('projects:list', {}))
    const created = await page.evaluate(
      (projectId) => window.wu.invoke('worktrees:create', { projectId, branch: 'nouveau', create: true }),
      project!.id,
    )
    expect(created).toBe(join(workspaceDir, 'alpha/nouveau'))

    await page.reload()
    await expect(dialog).toBeHidden()
    await page.getByRole('button', { name: /^Commandes/ }).click()
    const search = page.getByRole('combobox', { name: 'Rechercher une commande' })
    await search.fill('orca')
    await search.press('Enter')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Importer', exact: true }).click()
    await expect(tree.getByRole('treeitem', { name: 'alpha', exact: true })).toHaveCount(1)
    await expect(tree.getByRole('treeitem', { name: 'beta', exact: true })).toHaveCount(1)
    expect(readFileSync(source)).toEqual(before)
  } finally {
    await app.close()
  }
})
