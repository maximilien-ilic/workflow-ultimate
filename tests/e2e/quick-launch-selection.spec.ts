import { execFile, execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { _electron, expect, test } from '@playwright/test'

test('rappeler le lanceur actualise le worktree actif et conserve le prompt', async () => {
  const dir = test.info().outputPath()
  const config = join(dir, 'config')
  const workspace = join(dir, 'worktrees')
  const repos = ['a', 'b'].map((name) => ({
    name: `projet-${name}`, branch: `branche-${name}`, path: join(dir, `projet-${name}`),
  }))
  for (const { path, branch } of repos) {
    execFileSync('git', ['init', '-q', '-b', branch, path])
    execFileSync('git', ['-C', path, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init', '--allow-empty'])
  }
  mkdirSync(join(config, 'workflow-ultimate'), { recursive: true })
  writeFileSync(join(config, 'workflow-ultimate/settings.json'), JSON.stringify({
    orcaImport: { seen: true, workspaces: workspace },
  }))
  // shortcut: le runner Ubuntu isolé ne peut pas initialiser le sandbox Chromium.
  const noSandbox = process.env['CI'] ? ['--no-sandbox'] : []
  const args = [...noSandbox, 'out/main/index.js', '--user-data-dir=' + join(dir, 'profile')]
  const env = {
    ...process.env,
    XDG_CONFIG_HOME: config,
    XDG_DATA_HOME: join(dir, 'data'),
    WU_CLAUDE_BIN: resolve('tests/fixtures/fake-agent'),
    FAKE_AGENT_SCENARIO: 'question',
  }
  const app = await _electron.launch({ args, env })
  try {
    const main = await app.firstWindow()
    for (const { path } of repos) await main.evaluate((path) => window.wu.invoke('projects:add', { path }), path)
    await main.reload()
    const pick = (index: number) => main.getByRole('treeitem', { name: repos[index]!.branch, exact: true }).click()
    const exe = app.process().spawnfile
    const recall = () => promisify(execFile)(exe, [...args, '--action', 'agents.quick-launch'], { env, timeout: 5_000 })
    const open = async () => {
      const [opened] = await Promise.all([app.waitForEvent('window', { timeout: 5_000 }), recall()])
      return opened
    }
    const current = (index: number) => `Actif · ${repos[index]!.name} · ${repos[index]!.branch}`
    await pick(0)
    const launcher = await open()
    const prompt = launcher.getByRole('textbox', { name: 'Prompt' })
    await expect(launcher.getByRole('option', { name: current(0), exact: true })).toHaveCount(1)
    await prompt.fill('Garder le texte')
    await pick(1)
    await recall()
    await expect(launcher.getByRole('option', { name: current(1), exact: true })).toHaveCount(1)
    await expect(prompt).toHaveValue('Garder le texte')
    await launcher.getByRole('button', { name: 'Lancer' }).click()
    await expect(main.getByRole('tab', { name: /Claude · projet-b/ })).toHaveAttribute('aria-selected', 'true')

    const create = await open()
    await expect(create.getByRole('option', { name: current(1), exact: true })).toHaveCount(1)
    await pick(0)
    await recall()
    await expect(create.getByRole('option', { name: current(0), exact: true })).toHaveCount(1)
    await create.getByRole('textbox', { name: 'Prompt' }).fill('Nouvelle branche')
    await create.getByRole('combobox', { name: 'Worktree', exact: true }).selectOption('new')
    await create.getByRole('textbox', { name: 'Nom de la branche' }).fill('nouvelle')
    await create.getByRole('button', { name: 'Lancer' }).click()
    await expect(main.getByRole('tab', { name: /Claude · nouvelle/ })).toHaveAttribute('aria-selected', 'true')
    const sessions = await main.evaluate(() => window.wu.invoke('agents:list', {}))
    expect(sessions.map(({ cwd }) => cwd).sort()).toEqual([
      join(dir, 'projet-b'), join(workspace, 'projet-a', 'nouvelle'),
    ].sort())
  } finally {
    await app.close()
  }
})
