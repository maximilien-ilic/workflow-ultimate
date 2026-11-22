import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { _electron, expect, test } from '@playwright/test'

test('restores resized and hidden panels after restarting Electron', async () => {
  const configHome = test.info().outputPath('config')
  const launch = () =>
    _electron.launch({
      args: ['out/main/index.js', `--user-data-dir=${test.info().outputPath('profile')}`],
      env: { ...process.env, XDG_CONFIG_HOME: configHome, XDG_DATA_HOME: test.info().outputPath('data') },
    })
  const first = await launch()
  let savedWidth: number
  try {
    const page = await first.firstWindow()
    const left = page.getByRole('complementary', { name: 'Barre latérale' })
    const right = page.getByRole('complementary', { name: 'Contexte' })
    await expect(left).toBeVisible()
    await expect(right).toBeVisible()

    const handle = page.getByRole('separator', { name: 'Barre latérale' })
    const initialWidth = Number(await handle.getAttribute('aria-valuenow'))
    await handle.press('ArrowRight')
    savedWidth = initialWidth + 16
    await expect(handle).toHaveAttribute('aria-valuenow', String(savedWidth))

    const bounds = await handle.boundingBox()
    if (!bounds) throw new Error('Poignée introuvable')
    const x = bounds.x + bounds.width / 2
    const y = bounds.y + bounds.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 30, y)
    await page.mouse.up()
    savedWidth += 30
    await expect(handle).toHaveAttribute('aria-valuenow', String(savedWidth))

    await page.keyboard.press('Control+b')
    await expect(left).toBeHidden()
    await page.keyboard.press('Control+Alt+b')
    await expect(right).toBeHidden()
    await expect
      .poll(async () =>
        JSON.parse(await readFile(join(configHome, 'workflow-ultimate/settings.json'), 'utf8')),
      )
      .toMatchObject({ layout: { left: { width: savedWidth, visible: false }, right: { visible: false } } })
  } finally {
    await first.close()
  }

  const second = await launch()
  try {
    const page = await second.firstWindow()
    await expect(page.getByRole('button', { name: 'Barre latérale' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await expect(page.getByRole('button', { name: 'Contexte' })).toHaveAttribute('aria-pressed', 'false')
    await page.keyboard.press('Control+b')
    await expect(page.getByRole('separator', { name: 'Barre latérale' })).toHaveAttribute(
      'aria-valuenow',
      String(savedWidth),
    )
  } finally {
    await second.close()
  }
})
