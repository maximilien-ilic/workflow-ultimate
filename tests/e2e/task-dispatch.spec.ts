import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { _electron, expect, test, type Locator, type Page } from '@playwright/test'

let dir: string
test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wu-e2e-dispatch-'))
})
test.afterEach(() => rmSync(dir, { recursive: true, force: true }))

async function launchTaskProject(setupRepo?: (repo: string) => void) {
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
  setupRepo?.(repo)
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
  const page = await app.firstWindow()
  const project = await page.evaluate((path) => window.wu.invoke('projects:add', { path }), repo)
  await page.reload()
  return { app, page, projectId: project.id, promptFile, workspaces }
}

async function openBoard(page: Page) {
  await expect(page.getByRole('treeitem', { selected: true })).toBeVisible()
  await page.keyboard.press('Control+Shift+K')
  return page.getByRole('dialog', { name: 'Tableau de tâches' })
}

async function sendToCodex(card: Locator) {
  await card.getByRole('button', { name: 'Envoyer à un agent' }).click()
  await card.getByRole('combobox', { name: 'Agent' }).selectOption('codex')
  await card.getByRole('button', { name: 'Envoyer', exact: true }).click()
}

test('envoie une tâche à Codex avec son contexte et conserve le lien vers la session', async () => {
  const { app, page, projectId, promptFile, workspaces } = await launchTaskProject()
  try {
    const [task] = await page.evaluate(
      (id) =>
        window.wu.invoke('tasks:create', {
          projectId: id,
          title: 'Tester l’envoi',
          body: '- [ ] Conserver le lien',
        }),
      projectId,
    )
    if (!task) throw new Error('Tâche de test introuvable')
    const board = await openBoard(page)
    await sendToCodex(board)
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

test('limite quatre agents, réordonne les envois au clavier et reprend la file', async () => {
  const { app, page, projectId } = await launchTaskProject()
  try {
    const titles = ['Premier', 'Deuxième', 'Troisième', 'Quatrième']
    await page.evaluate(
      async ({ projectId, titles }) => {
        for (const title of titles) await window.wu.invoke('tasks:create', { projectId, title, body: '' })
      },
      { projectId, titles },
    )
    const board = await openBoard(page)
    const queue = board.getByRole('region', { name: 'File d’attente' })
    const limit = queue.getByRole('spinbutton', { name: 'Agents simultanés' })
    const doing = board.getByRole('region', { name: 'En cours' })
    await expect(limit).toHaveValue('3')
    await limit.fill('2')
    await limit.press('Enter')
    for (const title of titles) {
      await sendToCodex(board.getByRole('listitem').filter({ has: page.getByText(title, { exact: true }) }))
    }
    await expect(doing.getByRole('listitem')).toHaveCount(2)
    await expect(queue.getByRole('listitem')).toHaveText([/Troisième/, /Quatrième/])
    const advance = queue.getByRole('button', { name: 'Avancer « Quatrième »' })
    await advance.press('Enter')
    await expect(queue.getByRole('listitem')).toHaveText([/Quatrième/, /Troisième/])
    await expect(advance).toBeFocused()

    const sessions = () => page.evaluate(() => window.wu.invoke('agents:list', {}))
    await expect
      .poll(async () => (await sessions()).filter(({ state }) => state === 'waiting'))
      .toHaveLength(2)
    const first = (await sessions()).find(({ cwd }) => cwd.endsWith('-premier'))
    await page.evaluate((id) => window.wu.invoke('terminal:write', { id, data: 'oui\r' }), first!.terminalId!)
    await expect(doing).toContainText('Quatrième')
    await expect(queue.getByRole('listitem')).toHaveText([/Troisième/])

    await limit.fill('3')
    await limit.press('Enter')
    await expect(doing).toContainText('Troisième')
    await expect(queue.getByRole('listitem')).toHaveCount(0)
    expect(await sessions()).toHaveLength(4)
    expect(
      JSON.parse(readFileSync(join(dir, 'config', 'workflow-ultimate', 'settings.json'), 'utf8')),
    ).toMatchObject({ maxConcurrentAgents: 3 })
  } finally {
    await app.close()
  }
})


for (const remoteDefault of [false, true]) {
  test(`choisit le commit de référence pour une nouvelle tâche (${remoteDefault ? 'branche distante trunk' : 'main locale'})`, async () => {
    let reference: string
    let unrelated: string
    const existing = join(dir, 'existant')
    const { app, page, projectId } = await launchTaskProject((repo) => {
      const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()
      reference = git('rev-parse', 'main')
      git('switch', '-qc', 'sans-rapport')
      git('-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--allow-empty', '-qm', 'Sans rapport')
      unrelated = git('rev-parse', 'HEAD')
      if (remoteDefault) {
        git('update-ref', 'refs/remotes/origin/trunk', reference)
        git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk')
        git('branch', '-f', 'main', unrelated)
      }
      git('worktree', 'add', '-qb', 'branche-existante', existing)
    })
    try {
      const newTask = () => page.evaluate(async (projectId) =>
        (await window.wu.invoke('tasks:create', { projectId, title: 'Tâche', body: '' })).at(-1)!.id,
      projectId)
      const fresh = await newTask()
      const previous = await newTask()
      using db = new DatabaseSync(join(dir, 'data', 'workflow-ultimate', 'app.db'))
      db.prepare('UPDATE tasks SET agent_branch = ? WHERE id = ?').run('branche-existante', previous)
      const dispatch = (id: number) => page.evaluate(({ id, projectId }) =>
        window.wu.invoke('tasks:dispatch', { id, projectId, agent: 'codex' }), { id, projectId })
      await dispatch(fresh)
      await dispatch(previous)

      const cwd = db.prepare('SELECT cwd FROM tasks JOIN agent_sessions ON agent_sessions.id = agent_session_id WHERE tasks.id = ?')
      const commit = (id: number) => {
        const row = cwd.get(id) as { cwd: string } | undefined
        return row && execFileSync('git', ['-C', row.cwd, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
      }
      await expect.poll(() => commit(previous)).toBe(unrelated!)
      expect(cwd.get(previous)).toEqual({ cwd: existing })
      await expect.poll(() => commit(fresh)).toBe(reference!)
    } finally {
      await app.close()
    }
  })
}
