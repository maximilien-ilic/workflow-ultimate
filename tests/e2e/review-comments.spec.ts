import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron, expect, test } from '@playwright/test'

test('les commentaires persistent et arrivent dans le PTY en un seul message', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'wu-e2e-comments-')))
  const repo = join(dir, 'proj')
  const capture = join(dir, 'message')
  mkdirSync(repo)
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo })
  git('init', '-qb', 'main')
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-qm', 'base')
  writeFileSync(join(repo, 'a.txt'), 'première ligne\ndeuxième ligne\n')
  const app = await _electron.launch({
    args: ['out/main/index.js'],
    env: {
      ...process.env, XDG_DATA_HOME: join(dir, 'data'), XDG_CONFIG_HOME: join(dir, 'config'),
      WU_CLAUDE_BIN: resolve('tests/fixtures/fake-agent'), FAKE_AGENT_SCENARIO: 'review',
      FAKE_AGENT_REVIEW_CAPTURE: capture,
    },
  })
  try {
    const page = await app.firstWindow()
    await page.evaluate((path) => window.wu.invoke('projects:add', { path }), repo)
    await page.reload()
    const review = page.getByRole('dialog', { name: 'Diff du worktree' })
    const focusTerminal = () => page.locator('.terminal-host').first().click()
    const openReview = async () => {
      await focusTerminal()
      await page.keyboard.press('Control+Shift+G')
    }
    await page.getByRole('button', { name: 'Claude dans proj' }).click()
    await expect(page.getByRole('tab', { name: /Claude · proj/ })).toContainText('terminé')
    await openReview()
    const comments = review.getByRole('region', { name: 'Commentaires de revue' })
    const add = async (line: string, message: string) => {
      await comments.getByLabel('Ligne', { exact: true }).fill(line)
      await comments.getByRole('textbox', { name: 'Commentaire', exact: true }).fill(message)
      await comments.getByRole('button', { name: 'Ajouter le commentaire' }).click()
      await expect(comments.getByText(message, { exact: false })).toBeVisible()
    }
    await add('1', 'Vérifier ce mot.')
    await review.locator('.editor.modified .view-line').filter({ hasText: /deuxième\s+ligne/ })
      .click({ position: { x: 10, y: 7 } })
    await expect(comments.getByLabel('Ligne', { exact: true })).toHaveValue('2')
    await add('2', 'Ajouter un exemple.')
    await page.reload()
    await openReview()
    await expect(comments.getByText('Vérifier ce mot.', { exact: false })).toBeVisible()
    await comments.getByRole('button', { name: "Envoyer à l’agent" }).click()
    await expect.poll(() => existsSync(capture) ? readFileSync(capture, 'utf8') : '').toBe(
      '\x1b[200~Commentaires de revue :\na.txt:1 — Vérifier ce mot.\na.txt:2 — Ajouter un exemple.\x1b[201~\r',
    )
    await expect(comments.getByText('Envoyé', { exact: true })).toHaveCount(2)
    await page.reload()
    await openReview()
    await expect(comments.getByText('Envoyé', { exact: true })).toHaveCount(2)
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
