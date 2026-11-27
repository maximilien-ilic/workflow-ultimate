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
  const file = join(repo, 'a.txt')
  writeFileSync(file, 'première ligne\nà supprimer\ndernière ligne\n')
  git('add', 'a.txt')
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base')
  writeFileSync(file, 'nouvelle ligne\nune autre insertion\npremière ligne\ndernière ligne\n')
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
    const lineInput = comments.getByLabel('Ligne', { exact: true })
    await review.locator('.editor.original .view-line').filter({ hasText: /supprimer/ })
      .click({ position: { x: 10, y: 7 } })
    await expect(lineInput).toHaveValue('2')
    await expect(comments.getByText('Avant', { exact: true })).toBeVisible()
    await add('2', 'Vérifier la suppression.')
    await review.locator('.editor.modified .view-line').filter({ hasText: /première\s+ligne/ })
      .click({ position: { x: 10, y: 7 } })
    await expect(lineInput).toHaveValue('3')
    await expect(comments.getByText('Après', { exact: true })).toBeVisible()
    await page.keyboard.press('ArrowDown')
    await expect(lineInput).toHaveValue('4')
    await add('4', 'Ajouter un exemple.')
    const longComments = Array.from({ length: 6 }, (_, index) =>
      `${index + 1}. ${'界'.repeat(3_996)}`,
    )
    const [project] = await page.evaluate(() => window.wu.invoke('projects:list', {}))
    await page.evaluate(async ({ projectId, worktreePath, bodies }) => {
      for (const body of bodies)
        await window.wu.invoke('review:addComment', { projectId, worktreePath, path: 'a.txt', side: 'after', line: 4, body })
    }, { projectId: project!.id, worktreePath: repo, bodies: longComments })
    await page.reload()
    await openReview()
    await expect(comments.getByText('a.txt:2 (avant) — Vérifier la suppression.', { exact: false })).toBeVisible()
    await expect(comments.getByText('a.txt:4 (après) — Ajouter un exemple.', { exact: false })).toBeVisible()
    await comments.getByRole('button', { name: "Envoyer à l’agent" }).click()
    const expected = '\x1b[200~Commentaires de revue :\na.txt:2 (avant) — Vérifier la suppression.\na.txt:4 (après) — Ajouter un exemple.\n' +
      longComments.map((body) => `a.txt:4 (après) — ${body}`).join('\n') + '\x1b[201~\r'
    expect(Buffer.byteLength(expected)).toBeGreaterThan(64 * 1024)
    await expect.poll(() => existsSync(capture)).toBe(true)
    const received = readFileSync(capture, 'utf8')
    expect(Buffer.byteLength(received)).toBe(Buffer.byteLength(expected))
    expect(received === expected).toBe(true)
    await expect(comments.getByText('Envoyé', { exact: true })).toHaveCount(2 + longComments.length)
    await page.reload()
    await openReview()
    await expect(comments.getByText('Envoyé', { exact: true })).toHaveCount(2 + longComments.length)
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('le brouillon et sa ligne restent propres à chaque fichier pendant la revue', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'wu-e2e-comment-drafts-')))
  const repo = join(dir, 'proj')
  mkdirSync(repo)
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo })
  git('init', '-qb', 'main')
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-qm', 'base')
  writeFileSync(join(repo, 'a.txt'), 'a1\na2\na3\n')
  writeFileSync(join(repo, 'b.txt'), 'b1\nb2\nb3\n')

  const app = await _electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, XDG_DATA_HOME: join(dir, 'data'), XDG_CONFIG_HOME: join(dir, 'config') },
  })
  try {
    const page = await app.firstWindow()
    await page.evaluate((path) => window.wu.invoke('projects:add', { path }), repo)
    await page.reload()
    await page.getByRole('treeitem', { name: 'main', exact: true }).click()
    await page.keyboard.press('Control+Shift+G')
    const review = page.getByRole('dialog', { name: 'Diff du worktree' })
    const comments = review.getByRole('region', { name: 'Commentaires de revue' })
    const files = review.getByRole('list', { name: 'Fichiers modifiés' })
    const line = comments.getByLabel('Ligne', { exact: true })
    const draft = comments.getByRole('textbox', { name: 'Commentaire', exact: true })
    const select = (name: string) => files.getByRole('button', { name, exact: true }).click()

    await line.fill('2')
    await draft.fill('Brouillon A')
    await review.locator('.editor.modified .view-line').filter({ hasText: /^a3$/ }).click({ position: { x: 5, y: 7 } })
    await expect(line).toHaveValue('3')
    await expect(draft).toHaveValue('Brouillon A')
    await line.fill('2')
    await select('b.txt')
    await expect(draft).toHaveValue('')
    await line.fill('3')
    await draft.fill('Brouillon B')
    await select('a.txt')
    await expect(draft).toHaveValue('Brouillon A')
    await expect(line).toHaveValue('2')
    await comments.getByRole('button', { name: 'Ajouter le commentaire' }).click()
    await expect(comments.getByText(/a\.txt:2 \(après\) — Brouillon A/)).toBeVisible()
    await expect(draft).toHaveValue('')

    await select('b.txt')
    await expect(draft).toHaveValue('Brouillon B')
    await expect(line).toHaveValue('3')
    await select('a.txt')
    await expect(draft).toHaveValue('')
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
