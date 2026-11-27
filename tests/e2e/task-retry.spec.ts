import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { _electron, expect, test } from '@playwright/test'

test('réessaie un échec Codex dans le même worktree sans remplacer une session ouverte', async () => {
  const profile = test.info().outputPath()
  const config = join(profile, 'config')
  const data = join(profile, 'data')
  const repo = join(profile, 'projet')
  const agent = join(profile, 'agent')
  mkdirSync(join(config, 'workflow-ultimate'), { recursive: true })
  writeFileSync(join(config, 'workflow-ultimate/settings.json'), JSON.stringify({
    orcaImport: { seen: true, workspaces: join(profile, 'worktrees') },
  }))
  execFileSync('git', ['init', '-qb', 'main', repo])
  execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init', '--allow-empty'])
  writeFileSync(agent, `#!/bin/sh
if [ ! -f "$WU_RETRY_MARKER" ]; then touch "$WU_RETRY_MARKER"; exit 2; fi
exec "$WU_TEST_AGENT" "$@"
`, { mode: 0o700 })
  const app = await _electron.launch({
    args: ['out/main/index.js', '--user-data-dir=' + join(profile, 'electron')],
    env: {
      ...process.env, XDG_CONFIG_HOME: config, XDG_DATA_HOME: data,
      WU_CODEX_BIN: agent, WU_TEST_AGENT: resolve('tests/fixtures/fake-agent'),
      WU_RETRY_MARKER: join(profile, 'premier-essai'), FAKE_AGENT_SCENARIO: 'question',
    },
  })
  try {
    const page = await app.firstWindow()
    const { id: projectId } = await page.evaluate((path) => window.wu.invoke('projects:add', { path }), repo)
    const [task] = await page.evaluate((projectId) =>
      window.wu.invoke('tasks:create', { projectId, title: 'Réessayer', body: '' }),
    projectId)
    const request = { projectId, id: task!.id }
    const dispatch = () => page.evaluate((req) => window.wu.invoke('tasks:dispatch', { ...req, agent: 'codex' }), request)
    const moveBack = () => page.evaluate((req) => window.wu.invoke('tasks:move', { ...req, status: 'todo' }), request)
    const sessions = () => page.evaluate(() => window.wu.invoke('agents:list', {}))
    await dispatch()
    await expect.poll(sessions).toEqual([expect.objectContaining({ state: 'error', terminalId: null })])
    const [failed] = await sessions()

    await moveBack()
    await dispatch()
    await expect.poll(sessions).toEqual([
      expect.objectContaining({ state: 'waiting', cwd: failed!.cwd }),
      expect.objectContaining({ id: failed!.id, state: 'error', terminalId: null }),
    ])
    const [fresh] = await sessions()
    using db = new DatabaseSync(join(data, 'workflow-ultimate/app.db'), { readOnly: true })
    const linked = db.prepare('SELECT agent_session_id AS id FROM tasks WHERE id = ?')
    expect(linked.get(request.id)).toEqual({ id: fresh!.id })

    await moveBack()
    await expect(dispatch()).rejects.toThrow(/déjà été prise en charge/)
    expect(await sessions()).toHaveLength(2)
    expect(linked.get(request.id)).toEqual({ id: fresh!.id })
  } finally {
    await app.close()
  }
})
