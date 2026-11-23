import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultSettings } from '../../../shared/layout-defaults'
import { settingsSchema } from '../../../shared/settings'
import { readSettings, writeSettings } from './settings'

describe('settings', () => {
  let directory: string
  let file: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'wu-settings-'))
    file = join(directory, 'settings.json')
  })

  afterEach(() => rmSync(directory, { recursive: true, force: true }))

  it('rejette les réglages IPC inconnus, les types invalides et les largeurs hors limites', () => {
    expect(settingsSchema.safeParse({ ...defaultSettings, unrelated: true }).success).toBe(false)
    for (const width of [-1, 10000, 220.5, '240']) {
      const layout = { ...defaultSettings.layout, left: { width, visible: true } }
      expect(settingsSchema.safeParse({ layout }).success).toBe(false)
    }
  })

  it('remplace une largeur invalide sans perdre les autres réglages', () => {
    const right = { width: 320, visible: false }
    writeFileSync(file, JSON.stringify({ layout: { left: { width: 10000, visible: false }, right } }))
    expect(readSettings(file)).toEqual({
      ...defaultSettings,
      layout: { left: { width: defaultSettings.layout.left.width, visible: false }, right },
    })
  })

  it('restaure les valeurs par défaut pour un fichier absent ou invalide', () => {
    expect(readSettings(file)).toEqual(defaultSettings)
    writeFileSync(file, '{')
    expect(readSettings(file)).toEqual(defaultSettings)
  })

  it('remplace le fichier et ne laisse pas de fichier temporaire', () => {
    writeSettings(file, defaultSettings)
    const next = {
      ...defaultSettings,
      layout: { ...defaultSettings.layout, left: { width: 325, visible: false } },
    }
    writeSettings(file, next)
    expect(readSettings(file)).toEqual(next)
    expect(readdirSync(directory)).toEqual(['settings.json'])
  })
})

describe('raccourcis persistés', () => {
  it('accepte un ancien fichier de disposition sans raccourcis', () => {
    expect(settingsSchema.parse({ layout: defaultSettings.layout }).keybindings).toEqual({})
  })

  it('refuse les collisions avec la palette et les raccourcis par défaut', () => {
    for (const keybinding of ['Ctrl+K', 'Ctrl+Alt+B', 'ctrl+j']) {
      const payload = { ...defaultSettings, keybindings: { 'shell.toggle-left': keybinding } }
      expect(settingsSchema.safeParse(payload).success).toBe(false)
    }
    const keybindings = { 'shell.toggle-left': 'Ctrl+J', 'shell.toggle-right': 'Ctrl+B' }
    expect(settingsSchema.parse({ ...defaultSettings, keybindings }).keybindings).toEqual(keybindings)
  })
})
