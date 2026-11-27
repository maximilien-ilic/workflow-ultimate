import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { _electron, expect, test, type Page } from '@playwright/test'

const exec = promisify(execFile)
let output: string
test.beforeEach(() => {
  output = mkdtempSync(join(tmpdir(), 'wu-quick-launch-'))
})
test.afterEach(() => rmSync(output, { recursive: true, force: true }))

async function pressAndClose(page: Page, key: 'Escape' | 'Enter'): Promise<void> {
  try {
    await page.keyboard.press(key)
  } catch (error) {
    // Échap peut fermer la page avant l'envoi du relâchement de la touche.
    if (!page.isClosed()) throw error
  }
  await expect.poll(() => page.isClosed()).toBe(true)
}

test('ouvre le lanceur, annule avec Échap et lance dans le worktree choisi avec Entrée', async () => {
  const repo = join(output, 'projet')
  const active = join(output, 'actif')
  const config = join(output, 'config')
  const workspaces = join(output, 'worktrees')
  const agent = join(output, 'agent')
  mkdirSync(repo, { recursive: true })
  await exec('git', ['init', '-q', '-b', 'main', repo])
  await exec('git', [
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
  await exec('git', ['-C', repo, 'worktree', 'add', '-qb', 'actif', active])
  mkdirSync(join(config, 'workflow-ultimate'), { recursive: true })
  writeFileSync(
    join(config, 'workflow-ultimate', 'settings.json'),
    JSON.stringify({
      orcaImport: { seen: true, workspaces },
    }),
  )
  writeFileSync(agent, '#!/bin/bash\nprintf "Prompt : %s\\n" "${@: -1}"\nexec "$WU_TEST_AGENT" "$@"\n', {
    mode: 0o700,
  })

  // shortcut: le runner Ubuntu de la CI ne peut pas initialiser le sandbox Chromium.
  const noSandbox = process.env['CI'] ? ['--no-sandbox'] : []
  const args = [...noSandbox, 'out/main/index.js', '--user-data-dir=' + join(output, 'profile')]
  const env = {
    ...process.env,
    XDG_CONFIG_HOME: config,
    XDG_DATA_HOME: join(output, 'data'),
    WU_CLAUDE_BIN: agent,
    WU_CODEX_BIN: agent,
    WU_TEST_AGENT: resolve('tests/fixtures/fake-agent'),
    FAKE_AGENT_SCENARIO: 'question',
  }
  const app = await _electron.launch({ args, env })
  try {
    const mainWindow = await app.firstWindow()
    await mainWindow.evaluate((path) => window.wu.invoke('projects:add', { path }), repo)
    await mainWindow.reload()
    await mainWindow.getByRole('treeitem', { name: /actif/ }).click()
    const executable = await app.evaluate(() => process.execPath)
    async function openLauncher() {
      const nextWindow = app.waitForEvent('window', { timeout: 5_000 })
      await exec(executable, [...args, '--action', 'agents.quick-launch'], { env, timeout: 5_000 })
      return nextWindow
    }

    const cancelled = await openLauncher()
    await expect(cancelled.getByRole('textbox', { name: 'Prompt' })).toBeFocused()
    await pressAndClose(cancelled, 'Escape')
    const sessions = () => mainWindow.evaluate(() => window.wu.invoke('agents:list', {}))
    expect(await sessions()).toHaveLength(0)

    const launcher = await openLauncher()
    await expect(launcher.getByRole('option', { name: 'Actif · projet · actif', exact: true })).toHaveCount(1)
    const prompt = launcher.getByRole('textbox', { name: 'Prompt' })
    await prompt.fill('Question pour Claude')
    await pressAndClose(launcher, 'Enter')
    await expect(mainWindow.getByRole('tab', { name: /Claude · actif/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    const [running] = await sessions()
    expect(running).toMatchObject({ cwd: active, agent: 'claude-code' })
    const outputFor = (id: string) =>
      mainWindow.evaluate(async (id) => (await window.wu.invoke('terminal:attach', { id })).data, id)
    await expect.poll(() => outputFor(running!.terminalId!)).toContain('Prompt : Question pour Claude')

    const newLauncher = await openLauncher()
    await newLauncher.getByRole('combobox', { name: 'Agent', exact: true }).selectOption('codex')
    await newLauncher.getByRole('combobox', { name: 'Worktree', exact: true }).selectOption('new')
    await newLauncher.getByRole('textbox', { name: 'Nom de la branche' }).fill('feat/nouveau')
    const newPrompt = newLauncher.getByRole('textbox', { name: 'Prompt' })
    await newPrompt.fill('Question pour Codex')
    await expect(newLauncher.getByRole('button', { name: 'Lancer' })).toBeEnabled()
    await pressAndClose(newLauncher, 'Enter')
    await expect(mainWindow.getByRole('tab', { name: /Codex · feat-nouveau/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    const launched = (await sessions()).find(({ agent }) => agent === 'codex')
    expect(launched).toMatchObject({ agent: 'codex', cwd: join(workspaces, 'projet', 'feat-nouveau') })
    await expect.poll(() => outputFor(launched!.terminalId!)).toContain('Prompt : Question pour Codex')
  } finally {
    await app.close()
  }
})
