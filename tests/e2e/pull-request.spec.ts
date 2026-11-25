import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron, expect, test } from '@playwright/test'

test('le panneau de contexte publie le brouillon puis rafraîchit les checks', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'wu-e2e-pr-')))
  const repo = join(dir, 'repo')
  mkdirSync(repo)
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo })
  git('init', '-qb', 'feat/42-contexte')
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--allow-empty', '-qm', 'feat: contexte')
  git('remote', 'add', 'origin', 'https://github.com/example/projet.git')
  git('update-ref', 'refs/remotes/origin/feat/42-contexte', 'HEAD')
  git('branch', '--set-upstream-to=origin/feat/42-contexte')
  writeFileSync(join(dir, 'gh'), `#!/bin/sh
case "$2" in
  create)
    [ "$4" = '--title=Contexte révisé' ] && [ "$5" = '--body=Closes #42' ] || exit 2
    touch .git/fake-pr
    echo https://github.com/example/projet/pull/9 ;;
  view)
    if [ ! -f .git/fake-pr ]; then echo 'no pull requests found for branch' >&2; exit 1; fi
    echo '{"number":9,"title":"Contexte révisé","url":"https://github.com/example/projet/pull/9","state":"OPEN"}' ;;
  checks)
    if [ -f .git/fake-green ]; then echo '[{"name":"CI","bucket":"pass"}]'
    else echo '[{"name":"CI","bucket":"pending"}]'; exit 8; fi ;;
esac
`, { mode: 0o700 })

  const app = await _electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, PATH: dir + ':' + process.env.PATH,
      XDG_DATA_HOME: join(dir, 'data'), XDG_CONFIG_HOME: join(dir, 'config') },
  })
  try {
    const page = await app.firstWindow()
    await page.evaluate((path) => window.wu.invoke('projects:add', { path }), repo)
    await page.reload()
    const panel = page.getByRole('complementary', { name: 'Contexte' })
    const title = panel.getByRole('textbox', { name: 'Titre de la PR' })
    await expect(title).toHaveValue('feat: contexte')
    await expect(panel.getByRole('textbox', { name: 'Description de la PR' })).toHaveValue('Closes #42')
    await title.fill('Contexte révisé')
    await panel.getByRole('button', { name: 'Créer la PR' }).click()
    const prLink = panel.getByRole('link', { name: 'PR #9 · Contexte révisé' })
    await expect(prLink).toHaveAttribute(
      'href', 'https://github.com/example/projet/pull/9',
    )
    const opened = await app.evaluateHandle(({ BrowserWindow }) => {
      const urls: string[] = []
      BrowserWindow.getAllWindows()[0]!.webContents.ipc.handle('shell:openUrl', (_event, { url }) => {
        urls.push(url)
      })
      return urls
    })
    await prLink.click()
    await expect.poll(() => opened.jsonValue()).toEqual(['https://github.com/example/projet/pull/9'])
    await expect(panel.getByText('CI · En cours')).toBeVisible()
    writeFileSync(join(repo, '.git', 'fake-green'), '')
    await panel.getByRole('button', { name: 'Rafraîchir la PR' }).click()
    await expect(panel.getByText('CI · Réussi')).toBeVisible()
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
