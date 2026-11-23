import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { _electron, expect, test } from '@playwright/test'

test('opens Diagnostic from the palette and copies the displayed report', async () => {
  const testInfo = test.info()
  const state = testInfo.outputPath('state')
  const app = await _electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${testInfo.outputPath('profile')}`],
    env: {
      ...process.env,
      XDG_CONFIG_HOME: testInfo.outputPath('config'),
      XDG_DATA_HOME: testInfo.outputPath('data'),
      XDG_STATE_HOME: state,
      WEBHOOK_TOKEN: 'fixture-unshared-value',
    },
  })

  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'Commandes (Ctrl+Shift+P)' }).click()
    const search = page.getByRole('combobox', { name: 'Rechercher une commande' })
    await search.fill('diag')
    await search.press('Enter')
    const diagnostic = page.getByRole('dialog', { name: 'Diagnostic' })
    const report = diagnostic.getByLabel('Rapport de diagnostic')
    await expect(report).toContainText('Socket agents')
    await expect(report).toContainText('git :')
    await expect(report).not.toContainText('fixture-unshared-value')
    await diagnostic.getByRole('button', { name: 'Copier le rapport' }).click()
    await expect(diagnostic.getByRole('status')).toHaveText('Rapport copié.')
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(await report.textContent())

    await app.evaluate(() => console.warn('diagnostic e2e'))
    expect(await readFile(join(state, 'workflow-ultimate/logs/main.log'), 'utf8')).toContain(
      'WARN diagnostic e2e',
    )

    await diagnostic.getByRole('button', { name: 'Fermer' }).click()
    await expect(diagnostic).toBeHidden()
  } finally {
    await app.close()
  }
})
