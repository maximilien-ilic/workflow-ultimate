import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron, expect, test } from '@playwright/test'

let dir: string
test.beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'wu-e2e-agent-')))
})
test.afterEach(() => rmSync(dir, { recursive: true, force: true }))

test("un agent lancé depuis un projet remonte ses états jusqu'à l'onglet", async () => {
  const repo = join(dir, 'proj')
  mkdirSync(repo)
  execFileSync('git', ['init', '-q', repo])

  // Le faux agent remplace `claude` : mêmes événements que les vrais hooks, via wu-notify et le socket.
  const app = await _electron.launch({
    args: ['out/main/index.js'],
    env: {
      ...process.env,
      XDG_DATA_HOME: join(dir, 'data'),
      XDG_CONFIG_HOME: join(dir, 'config'),
      WU_CLAUDE_BIN: resolve('tests/fixtures/fake-agent'),
      FAKE_AGENT_SCENARIO: 'question',
    },
  })
  const page = await app.firstWindow()
  await page.evaluate((path) => window.wu.invoke('projects:add', { path }), repo)
  await page.reload()

  await page.getByRole('button', { name: 'Claude dans proj' }).click()
  const tab = page.getByRole('tab', { name: /Claude · proj/ })
  await expect(tab).toContainText('attend une réponse')

  await page.locator('.terminal-host').first().click()
  await page.keyboard.type('oui\n')
  await expect(tab).toContainText('terminé')

  const sessions = await page.evaluate(() => window.wu.invoke('agents:list', {}))
  expect(sessions).toHaveLength(1)
  expect(sessions[0]).toMatchObject({ agent: 'claude-code', cwd: repo, state: 'done' })
  await app.close()
})

test('Codex stocke le thread signalé par notify et reprend ce thread après la sortie', async () => {
  const repo = join(dir, 'proj')
  mkdirSync(repo)
  execFileSync('git', ['init', '-q', repo])
  const app = await _electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${join(dir, 'profile')}`],
    env: {
      ...process.env,
      XDG_DATA_HOME: join(dir, 'data'),
      XDG_CONFIG_HOME: join(dir, 'config'),
      WU_CODEX_BIN: resolve('tests/fixtures/fake-agent'),
      FAKE_AGENT_SCENARIO: 'question',
    },
  })
  try {
    const page = await app.firstWindow()
    await page.evaluate((path) => window.wu.invoke('projects:add', { path }), repo)
    await page.reload()
    await page.getByRole('button', { name: 'Codex dans proj' }).click()
    const tab = page.getByRole('tab', { name: /Codex · proj/ })
    await expect(tab).toBeVisible()
    const sessions = () => page.evaluate(() => window.wu.invoke('agents:list', {}))
    const id = (await sessions())[0]!.id
    const resume = (sessionId: string, terminalId: string) =>
      page.evaluate(
        ({ sessionId, terminalId }) =>
          window.wu.invoke('agents:resume', { sessionId, terminalId, cols: 80, rows: 24 }),
        { sessionId, terminalId },
      )
    await expect(resume(id, crypto.randomUUID())).rejects.toThrow(/identifiant.*Codex/i)
    await page.locator('.terminal-host').first().click()
    await page.keyboard.type('oui\n')
    await expect(tab).toContainText('terminé')
    await expect
      .poll(async () => (await sessions())[0])
      .toMatchObject({ agent: 'codex', terminalId: null, state: 'done' })

    const terminalId = crypto.randomUUID()
    await expect(resume(id, terminalId)).resolves.toMatchObject({ id, agent: 'codex' })
    const output = () =>
      page.evaluate(async (id) => (await window.wu.invoke('terminal:attach', { id })).data, terminalId)
    await expect.poll(output).toContain('Reprise du thread 019a0000-0000-7000-8000-000000000001')
  } finally {
    await app.close()
  }
})
