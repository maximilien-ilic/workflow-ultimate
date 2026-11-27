import { execFileSync } from 'node:child_process'
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { _electron, expect, test } from '@playwright/test'

test('le Kanban affiche un envoi échoué pendant sa fermeture et efface l’erreur après réessai', async () => {
  const profile = test.info().outputPath()
  const config = join(profile, 'config')
  const workspaces = join(profile, 'worktrees')
  const repo = join(profile, 'projet')
  mkdirSync(join(config, 'workflow-ultimate'), { recursive: true })
  writeFileSync(workspaces, 'empêche la création du worktree')
  writeFileSync(join(config, 'workflow-ultimate/settings.json'), JSON.stringify({
    orcaImport: { seen: true, workspaces },
  }))
  execFileSync('git', ['init', '-qb', 'main', repo])
  execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init', '--allow-empty'])
  const app = await _electron.launch({
    args: ['out/main/index.js', '--user-data-dir=' + join(profile, 'electron')],
    env: {
      ...process.env, XDG_CONFIG_HOME: config, XDG_DATA_HOME: join(profile, 'data'),
      WU_CODEX_BIN: resolve('tests/fixtures/fake-agent'), FAKE_AGENT_SCENARIO: 'question',
    },
  })

  try {
    const page = await app.firstWindow()
    const { id: projectId } = await page.evaluate((path) => window.wu.invoke('projects:add', { path }), repo)
    const [task] = await page.evaluate((projectId) =>
      window.wu.invoke('tasks:create', { projectId, title: 'Tâche à relancer', body: '' }),
    projectId)
    await page.reload()
    await expect(page.getByRole('treeitem', { selected: true })).toBeVisible()
    await page.evaluate(({ id, projectId }) => window.wu.invoke('tasks:dispatch', { id, projectId, agent: 'codex' }), {
      id: task!.id, projectId,
    })
    await expect.poll(() => page.evaluate((projectId) => window.wu.invoke('tasks:dispatchFailures', { projectId }), projectId))
      .toEqual([{ id: task!.id, message: expect.stringContaining('ENOTDIR') }])

    await page.keyboard.press('Control+Shift+K')
    const board = page.getByRole('dialog', { name: 'Tableau de tâches' })
    const failures = board.getByRole('list', { name: 'Échecs d’envoi' })
    await expect(failures).toContainText('Tâche à relancer')
    unlinkSync(workspaces)
    await board.getByRole('button', { name: 'Envoyer à un agent' }).click()
    await board.getByRole('combobox', { name: 'Agent' }).selectOption('codex')
    await board.getByRole('button', { name: 'Envoyer', exact: true }).click()
    await expect(board.getByRole('region', { name: 'En cours' })).toContainText('Tâche à relancer')
    await expect(failures).toHaveCount(0)
  } finally {
    await app.close()
  }
})
