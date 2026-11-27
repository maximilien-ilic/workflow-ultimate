import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { _electron, expect, test } from '@playwright/test'

test('l’option applique les couleurs KDE et suit leur remplacement à chaud', async () => {
  const profile = test.info().outputPath()
  const config = join(profile, 'config')
  mkdirSync(config, { recursive: true })
  const globals = join(config, 'kdeglobals')
  const writePalette = (accent: string) => {
    writeFileSync(globals + '.new', `[General]
AccentColor=${accent}
[Colors:Window]
BackgroundNormal=24,32,48
ForegroundNormal=235,238,245
`)
    renameSync(globals + '.new', globals)
  }
  writePalette('100,144,210')
  const app = await _electron.launch({
    args: ['out/main/index.js', '--user-data-dir=' + join(profile, 'electron')],
    env: { ...process.env, XDG_CONFIG_HOME: config, XDG_DATA_HOME: join(profile, 'data') },
  })
  try {
    const page = await app.firstWindow()
    const follow = page.getByRole('checkbox', { name: 'Suivre le thème KDE' })
    const root = page.locator('html')
    await follow.focus()
    await follow.press('Space')
    await expect(follow).toBeChecked()
    await expect(root).toHaveCSS('background-color', 'rgb(24, 32, 48)')
    await expect(root).toHaveCSS('color', 'rgb(235, 238, 245)')
    await expect(root).toHaveCSS('accent-color', 'rgb(100, 144, 210)')

    writePalette('228,152,64')
    await expect(root).toHaveCSS('accent-color', 'rgb(228, 152, 64)')
    await page.reload()
    await expect(follow).toBeChecked()
    await expect(root).toHaveCSS('accent-color', 'rgb(228, 152, 64)')
    await follow.uncheck()
    await expect(root).not.toHaveCSS('accent-color', 'rgb(228, 152, 64)')
  } finally {
    await app.close()
  }
})
