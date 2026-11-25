import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron, expect, test } from '@playwright/test'

let dir: string
test.beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'wu-e2e-review-')))
})
test.afterEach(() => rmSync(dir, { recursive: true, force: true }))

test('Ctrl+Shift+G affiche les fichiers modifiés et leur diff, Alt+↓ passe au suivant', async () => {
  const repo = join(dir, 'proj')
  mkdirSync(repo)
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo })
  git('init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'calc.ts'), 'export const total = 1 + 1\n')
  writeFileSync(join(repo, 'vieux.md'), 'à supprimer\n')
  git('add', '.')
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base')
  git('switch', '-q', '-c', 'feat/1-calc')
  writeFileSync(join(repo, 'calc.ts'), 'export const total = 40 + 2\n')
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'calcul')
  writeFileSync(join(repo, 'nouveau.ts'), 'export const neuf = true\n') // non suivi
  unlinkSync(join(repo, 'vieux.md')) // non commité

  const app = await _electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, XDG_DATA_HOME: join(dir, 'data'), XDG_CONFIG_HOME: join(dir, 'config') },
  })
  const page = await app.firstWindow()
  await page.evaluate((path) => window.wu.invoke('projects:add', { path }), repo)
  await page.reload()
  await page.getByRole('button', { name: 'Terminal dans proj' }).click()
  await page.locator('.terminal-host').first().click()

  await page.keyboard.press('Control+Shift+G')
  const review = page.getByRole('dialog', { name: 'Diff du worktree' })
  await expect(review.getByRole('heading')).toHaveText('Diff par rapport à main')
  const files = review.getByRole('list', { name: 'Fichiers modifiés' }).getByRole('listitem')
  await expect(files).toHaveText(['M calc.ts', 'A nouveau.ts', 'D vieux.md'])

  // Monaco rend du texte dans le DOM : avant à gauche, après à droite .
  await expect(review.locator('.editor.original')).toContainText('1 + 1')
  await expect(review.locator('.editor.modified')).toContainText('40 + 2')

  await page.keyboard.press('Alt+ArrowDown')
  await expect(files.nth(1).getByRole('button')).toHaveAttribute('aria-current', 'true')
  await expect(review.locator('.editor.modified')).toContainText('neuf')

  // Commit partiel : seul vieux.md (décoché) reste non commité. La liste, elle, compare au point de
  // départ de la branche : les fichiers commités y restent, c'est voulu.
  await review.getByRole('checkbox', { name: 'Inclure vieux.md dans le commit' }).uncheck()
  await review.getByRole('textbox', { name: 'Message de commit' }).fill('feat: calcul et nouveau fichier')
  await review.getByRole('button', { name: 'Commiter' }).click()
  await expect(review.getByRole('status').last()).toContainText(/Commit [0-9a-f]{7} créé/)
  expect(git('status', '--porcelain').toString().trim()).toBe('D vieux.md')

  // Sans dépôt distant, l'erreur de git s'affiche telle quelle.
  await review.getByRole('button', { name: 'Pousser' }).click()
  await expect(review.getByRole('status').last()).toContainText('origin')
  await app.close()
})
