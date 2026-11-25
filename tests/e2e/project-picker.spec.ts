import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { _electron, expect, test } from '@playwright/test'

test('Ctrl+Maj+O trouve les projets et worktrees et garde les derniers choix', async () => {
  const outputPath = (name: string) => test.info().outputPath(name)
  const alpha = outputPath('alpha')
  const beta = outputPath('bêta')
  for (const repo of [alpha, beta]) {
    mkdirSync(repo, { recursive: true })
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo })
    execFileSync(
      'git',
      ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init'],
      { cwd: repo },
    )
  }
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'feature/rapide', outputPath('linked')], { cwd: beta })

  const launch = () =>
    _electron.launch({
      args: ['out/main/index.js', `--user-data-dir=${outputPath('profile')}`],
      env: { ...process.env, XDG_CONFIG_HOME: outputPath('config'), XDG_DATA_HOME: outputPath('data') },
    })
  const app = await launch()
  try {
    const page = await app.firstWindow()
    await page.evaluate(
      async (paths) => {
        for (const path of paths) await window.wu.invoke('projects:add', { path })
      },
      [alpha, beta],
    )
    await page.reload()
    const tree = page.getByRole('tree', { name: 'Projets et worktrees' })
    await tree.getByRole('treeitem', { name: 'bêta', exact: true }).click() // groupe replié
    await page.getByRole('button', { name: 'Terminal dans alpha' }).click()
    await expect(page.getByRole('textbox', { name: 'Terminal input' })).toBeFocused()
    await page.keyboard.press('Control+Shift+o')
    const picker = page.getByRole('dialog', { name: 'Projets et worktrees' })
    const search = picker.getByRole('combobox')
    await expect(search).toBeFocused()
    await search.fill('betaftrrp') // accents ignorés, sous-séquence du libellé projet + branche
    await search.press('Enter')
    await expect(picker).toBeHidden()
    await expect(tree.getByRole('treeitem', { name: 'feature/rapide' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await page.keyboard.press('Control+Shift+o')
    await expect(picker.getByRole('option').first()).toHaveText('bêta · feature/rapide')
    await search.fill('alpha')
    await search.press('Enter')
    await expect(page.getByRole('button', { name: 'Terminal dans alpha' })).toBeVisible()
  } finally {
    await app.close()
  }

  const restarted = await launch()
  try {
    const page = await restarted.firstWindow()
    await expect(page.getByRole('treeitem', { name: 'bêta', exact: true })).toBeVisible()
    await page.keyboard.press('Control+Shift+o')
    const picker = page.getByRole('dialog', { name: 'Projets et worktrees' })
    await expect(picker.getByRole('option').first()).toHaveText('alpha')
    await expect(picker.getByRole('option').nth(1)).toHaveText('bêta · feature/rapide')
  } finally {
    await restarted.close()
  }
})
