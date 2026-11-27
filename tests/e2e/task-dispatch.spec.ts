import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { _electron, expect, test } from '@playwright/test'

let dir: string
test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wu-e2e-dispatch-'))
})
test.afterEach(() => rmSync(dir, { recursive: true, force: true }))

test('envoie une tâche à Codex avec son contexte et conserve le lien vers la session', async () => {
  const repo = join(dir, 'projet')
  const config = join(dir, 'config', 'workflow-ultimate')
  const workspaces = join(dir, 'worktrees')
  const promptFile = join(dir, 'prompt')
  const agent = join(dir, 'agent')
  execFileSync('git', ['init', '-qb', 'main', repo])
  execFileSync('git', [
    '-C',
    repo,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '--allow-empty',
    '-qm',
    'Initial',
  ])
  mkdirSync(config, { recursive: true })
  writeFileSync(join(config, 'settings.json'), JSON.stringify({ orcaImport: { seen: true, workspaces } }))
  writeFileSync(
    agent,
    '#!/bin/bash\nprintf "%s" "${@: -1}" > "$WU_TEST_PROMPT"\nexec "$WU_TEST_AGENT" "$@"\n',
    { mode: 0o700 },
  )
  const app = await _electron.launch({
    args: ['out/main/index.js', '--user-data-dir=' + join(dir, 'profile')],
    env: {
      ...process.env,
      XDG_DATA_HOME: join(dir, 'data'),
      XDG_CONFIG_HOME: join(dir, 'config'),
      WU_CODEX_BIN: agent,
      WU_TEST_AGENT: resolve('tests/fixtures/fake-agent'),
      WU_TEST_PROMPT: promptFile,
      FAKE_AGENT_SCENARIO: 'question',
    },
  })
  try {
    const page = await app.firstWindow()
    const task = await page.evaluate(async (path) => {
      const project = await window.wu.invoke('projects:add', { path })
      return (
        await window.wu.invoke('tasks:create', {
          projectId: project.id,
          title: 'Tester l’envoi',
          body: '- [ ] Conserver le lien',
        })
      )[0]!
    }, repo)
    await page.reload()
    await expect(page.getByRole('treeitem', { selected: true })).toBeVisible()
    await page.keyboard.press('Control+Shift+K')
    const board = page.getByRole('dialog', { name: 'Tableau de tâches' })
    await board.getByRole('button', { name: 'Envoyer à un agent' }).click()
    await board.getByRole('combobox', { name: 'Agent' }).selectOption('codex')
    await board.getByRole('button', { name: 'Envoyer', exact: true }).click()
    await expect(board.getByRole('region', { name: 'En cours' })).toContainText(task.title)
    await board.getByRole('button', { name: 'Fermer' }).click()
    const branch = `feat/${task.id}-tester-l-envoi`
    await expect(page.getByRole('tab', { name: `Codex · ${branch}` })).toBeVisible()
    await expect.poll(() => readFileSync(promptFile, 'utf8')).toContain('AGENTS.md')
    const prompt = readFileSync(promptFile, 'utf8')
    expect(prompt).toContain(task.title)
    expect(prompt).toContain(task.body)
    expect(prompt).toContain('docs/SPEC.md')
    using db = new DatabaseSync(join(dir, 'data', 'workflow-ultimate', 'app.db'), { readOnly: true })
    expect(
      db
        .prepare(
          'SELECT agent_session_id, agent_branch, cwd FROM tasks JOIN agent_sessions ON agent_sessions.id = agent_session_id WHERE tasks.id = ?',
        )
        .get(task.id),
    ).toEqual({
      agent_session_id: expect.any(String),
      agent_branch: branch,
      cwd: join(workspaces, 'projet', branch.replace('/', '-')),
    })
  } finally {
    await app.close()
  }
})
