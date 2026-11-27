import { _electron, expect, test } from '@playwright/test'

test('applique les tokens sombres et clairs, conserve le choix et affiche le focus clavier', async () => {
  const info = test.info()
  const app = await _electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${info.outputPath('profile')}`],
    env: {
      ...process.env,
      XDG_CONFIG_HOME: info.outputPath('config'),
      XDG_DATA_HOME: info.outputPath('data'),
    },
  })
  try {
    const page = await app.firstWindow()
    const root = page.locator('html')
    await expect(root).toHaveAttribute('data-theme', 'dark')
    await expect(root).toHaveCSS('background-color', 'rgb(15, 17, 21)')
    const theme = page.getByRole('button', { name: 'Thème clair', exact: true })
    await page.getByRole('button', { name: /^Commandes/ }).focus()
    await page.keyboard.press('Tab')
    await expect(theme).toBeFocused()
    await expect(theme).toHaveCSS('outline-width', '2px')
    await page.keyboard.press('Enter')
    await expect(root).toHaveAttribute('data-theme', 'light')
    await expect(root).toHaveCSS('background-color', 'rgb(247, 248, 251)')
    await page.reload()
    await expect(root).toHaveAttribute('data-theme', 'light')
    await page.getByRole('button', { name: /^Commandes/ }).click()
    await expect(page.getByRole('option', { name: 'Design system', exact: true })).toHaveCount(0)
  } finally {
    await app.close()
  }
})
