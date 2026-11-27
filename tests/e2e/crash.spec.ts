import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

function isolatedProfile() {
  const output = test.info().outputPath()
  const repo = join(output, 'projet')
  const data = join(output, 'data')
  mkdirSync(repo, { recursive: true })
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  return {
    repo,
    data,
    launch: () => _electron.launch({
      args: ['out/main/index.js', '--user-data-dir=' + join(output, 'profile')],
      env: {
        ...process.env,
        SHELL: '/bin/bash',
        INPUTRC: '/dev/null',
        XDG_DATA_HOME: data,
        XDG_CONFIG_HOME: join(output, 'config'),
        WU_CLAUDE_BIN: resolve('tests/fixtures/fake-agent'),
        FAKE_AGENT_SCENARIO: 'question',
      },
    }),
  }
}

async function openProject(page: Page, repo: string) {
  const project = await page.evaluate((path) => window.wu.invoke('projects:add', { path }), repo)
  await page.reload()
  await page.getByRole('button', { name: 'Terminal dans projet' }).click()
  const terminalId = (await page.locator('.terminal-host').getAttribute('data-terminal-id'))!
  await page.getByRole('button', { name: 'Claude dans projet' }).click()
  await expect(page.getByRole('tab', { name: /Claude · projet/ })).toContainText('attend une réponse')
  const [agent] = await page.evaluate(() => window.wu.invoke('agents:list', {}))
  return { project, terminalId, agent: agent! }
}

const send = (page: Page, id: string, data: string) =>
  page.evaluate(({ id, data }) => window.wu.invoke('terminal:write', { id, data }), { id, data })

function currentRenderer<T>(app: ElectronApplication, source: string): Promise<T> {
  return app.evaluate(({ BrowserWindow }, source) =>
    BrowserWindow.getAllWindows()[0]!.webContents.executeJavaScript(source) as Promise<T>,
  source)
}

test('après un crash renderer, une recharge conserve les terminaux et la session d’agent', async () => {
  const profile = isolatedProfile()
  const app = await profile.launch()
  try {
    const page = await app.firstWindow()
    const { terminalId, agent } = await openProject(page, profile.repo)
    await send(page, terminalId, 'echo prêt-$((4+3)); read x; echo reprise-$((x*2))\n')
    const attach = `window.wu.invoke('terminal:attach', { id: ${JSON.stringify(terminalId)} }).then((reply) => reply.data)`
    await expect.poll(() => currentRenderer<string>(app, attach)).toContain('prêt-7')

    await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0]!.webContents
      return new Promise<void>((resolve) => {
        contents.once('render-process-gone', () => {
          contents.once('did-finish-load', resolve)
          contents.reload()
        })
        contents.forcefullyCrashRenderer()
      })
    })

    expect(await currentRenderer(app, "window.wu.invoke('agents:list', {})")).toEqual([
      expect.objectContaining({ id: agent.id, terminalId: agent.terminalId, state: 'waiting' }),
    ])
    expect(await currentRenderer(app, "window.wu.invoke('terminal:workspace', {})")).toMatchObject({
      livePanes: expect.arrayContaining([terminalId, agent.terminalId]),
    })
    expect(await currentRenderer<string>(app, attach)).toContain('prêt-7')
    const writeAfterCrash = (id: string, data: string) =>
      currentRenderer(app, `window.wu.invoke('terminal:write', ${JSON.stringify({ id, data })})`)
    await writeAfterCrash(terminalId, '21\n')
    await writeAfterCrash(agent.terminalId!, 'oui\n')
    await expect.poll(() => currentRenderer<string>(app, attach)).toContain('reprise-42')
    await expect.poll(() => currentRenderer(app, "window.wu.invoke('agents:list', {})")).toEqual([
      expect.objectContaining({ id: agent.id, state: 'done' }),
    ])
  } finally {
    await app.close()
  }
})

test('après un crash du main, la relance restaure le projet, la session et le scrollback sauvegardé', async () => {
  const profile = isolatedProfile()
  const app = await profile.launch()
  const main = app.process()
  let saved: Awaited<ReturnType<typeof openProject>>
  try {
    const page = await app.firstWindow()
    saved = await openProject(page, profile.repo)
    await send(page, saved.terminalId, 'echo avant-crash-$((6*7))\n')
    const snapshot = join(profile.data, 'workflow-ultimate/terminal-history', saved.terminalId + '.json')
    await expect.poll(
      () => existsSync(snapshot) ? readFileSync(snapshot, 'utf8') : '',
      { timeout: 12_000 },
    ).toContain('avant-crash-42')

    const exited = once(main, 'exit')
    expect(main.kill('SIGKILL')).toBe(true)
    expect(await exited).toEqual([null, 'SIGKILL'])
  } finally {
    if (main.exitCode === null && main.signalCode === null) await app.close()
  }

  const restarted = await profile.launch()
  try {
    const page = await restarted.firstWindow()
    await expect(page.getByRole('treeitem', { name: 'projet', exact: true })).toBeVisible()
    expect(await page.evaluate(() => window.wu.invoke('projects:list', {}))).toEqual([
      expect.objectContaining({ id: saved.project.id, path: profile.repo }),
    ])
    expect(await page.evaluate(() => window.wu.invoke('agents:list', {}))).toEqual([
      expect.objectContaining({ id: saved.agent.id, terminalId: null, cwd: profile.repo }),
    ])
    await expect.poll(() => currentRenderer<string>(restarted,
      `window.__wuTerminalText(${JSON.stringify(saved.terminalId)})`,
    )).toContain('avant-crash-42')
  } finally {
    await restarted.close()
  }
})
