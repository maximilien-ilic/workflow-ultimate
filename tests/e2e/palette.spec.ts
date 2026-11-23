import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { _electron, expect, test } from '@playwright/test'

test('opens the palette, runs commands and restores custom shortcuts', async () => {
  const configHome = test.info().outputPath('config')
  const launch = () =>
    _electron.launch({
      args: ['out/main/index.js', `--user-data-dir=${test.info().outputPath('profile')}`],
      env: { ...process.env, XDG_CONFIG_HOME: configHome, XDG_DATA_HOME: test.info().outputPath('data') },
    })
  const first = await launch()
  try {
    const page = await first.firstWindow()
    const previous = page.getByRole('button', { name: 'Barre latérale' })
    await expect(previous).toBeEnabled()
    await previous.focus()
    await page.keyboard.press('Control+Shift+p')
    const palette = page.getByRole('dialog', { name: 'Palette de commandes' })
    const search = palette.getByRole('combobox')
    await expect(search).toBeFocused()
    await search.fill('Basculer')
    await expect(palette.getByRole('listbox').getByRole('option')).toHaveCount(2)
    await search.press('ArrowDown')
    await expect(palette.getByRole('option', { selected: true })).toContainText('contexte')
    await search.press('Enter')
    await expect(page.getByRole('complementary', { name: 'Contexte' })).toBeHidden()
    await expect(previous).toBeFocused()

    await page.keyboard.press('Control+Shift+p')
    await search.fill('latérale')
    await expect(palette.getByRole('option')).toContainText('Ctrl+Shift+B')
    await palette.getByRole('button', { name: 'Modifier le raccourci' }).click()
    const binding = palette.getByRole('textbox', { name: 'Nouveau raccourci' })
    const save = palette.getByRole('button', { name: 'Enregistrer' })
    await binding.fill('Ctrl+Alt+Shift+B')
    await save.click()
    await expect(palette.getByRole('alert')).toContainText('contexte')
    await binding.fill('Ctrl+J')
    await save.click()
    await expect(palette.getByRole('option')).toContainText('Ctrl+J')
    await search.press('Escape')
    await expect(palette).toBeHidden()
    await expect(previous).toBeFocused()
    await expect
      .poll(async () =>
        JSON.parse(await readFile(join(configHome, 'workflow-ultimate/settings.json'), 'utf8')),
      )
      .toMatchObject({ keybindings: { 'shell.toggle-left': 'Ctrl+J' } })
  } finally {
    await first.close()
  }

  const second = await launch()
  try {
    const page = await second.firstWindow()
    const left = page.getByRole('complementary', { name: 'Barre latérale' })
    await expect(page.getByRole('button', { name: 'Barre latérale' })).toBeEnabled()
    await page.keyboard.press('Control+Shift+b')
    await expect(left).toBeVisible()
    await page.keyboard.press('Control+j')
    await expect(left).toBeHidden()
  } finally {
    await second.close()
  }
})
