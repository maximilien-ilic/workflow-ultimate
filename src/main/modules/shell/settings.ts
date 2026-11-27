import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { defaultSettings } from '../../../shared/layout-defaults'
import { DEFAULT_AGENT_CONCURRENCY, decodeSettings, type Settings, type StoredSettings } from '../../../shared/settings'
import { handle } from './ipc'
import { appDirectory } from './paths'

export function readSettings(file: string): StoredSettings {
  try {
    return decodeSettings(JSON.parse(readFileSync(file, 'utf8')))
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return defaultSettings
    }
    throw error
  }
}

export function writeSettings(file: string, settings: StoredSettings): void {
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
  const { layout, keybindings, orcaImport } = readSettings(settingsFile())
  return { layout, keybindings, orcaImport }
}

export function notificationSound(): boolean {
  return readSettings(settingsFile()).notificationSound ?? true
}

export function setNotificationSound(enabled: boolean): void {
  const file = settingsFile()
  writeSettings(file, { ...readSettings(file), notificationSound: enabled })
}

export function readAgentConcurrency(): number {
  return readSettings(settingsFile()).maxConcurrentAgents ?? DEFAULT_AGENT_CONCURRENCY
}

export function saveAgentConcurrency(max: number): void {
  const file = settingsFile()
  writeSettings(file, { ...readSettings(file), maxConcurrentAgents: max })
}

export function saveOrcaImport(workspaces?: string): void {
  const settings = readSettings(settingsFile())
  writeSettings(settingsFile(), {
    ...settings,
    orcaImport: { seen: true, workspaces: workspaces ?? settings.orcaImport?.workspaces },
  })
}

export function registerSettings(): void {
  handle('settings:get', readAppSettings)
  handle('settings:set', ({ layout, keybindings }) => {
    // L'import Orca peut avoir mis à jour son dossier depuis le dernier chargement du renderer.
    writeSettings(settingsFile(), { ...readSettings(settingsFile()), layout, keybindings })
    return null
  })
}
