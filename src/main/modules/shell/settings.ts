import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { defaultSettings } from '../../../shared/layout-defaults'
import { decodeSettings, type Settings } from '../../../shared/settings'
import { handle } from './ipc'
import { appDirectory } from './paths'

export function readSettings(file: string): Settings {
  try {
    return decodeSettings(JSON.parse(readFileSync(file, 'utf8')))
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return defaultSettings
    }
    throw error
  }
}

export function writeSettings(file: string, settings: Settings): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, JSON.stringify(settings), { mode: 0o600, flag: 'wx' })
    renameSync(temporary, file)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}

const settingsFile = () => join(appDirectory('config'), 'settings.json')

export function readAppSettings(): Settings {
  return readSettings(settingsFile())
}

export function saveOrcaImport(workspaces?: string): void {
  const settings = readAppSettings()
  writeSettings(settingsFile(), {
    ...settings,
    orcaImport: { seen: true, workspaces: workspaces ?? settings.orcaImport?.workspaces },
  })
}

export function registerSettings(): void {
  handle('settings:get', readAppSettings)
  handle('settings:set', ({ layout, keybindings }) => {
    // L'import Orca peut avoir mis à jour son dossier depuis le dernier chargement du renderer.
    writeSettings(settingsFile(), { ...readAppSettings(), layout, keybindings })
    return null
  })
}
