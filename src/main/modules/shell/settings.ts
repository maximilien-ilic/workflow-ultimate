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

export function registerSettings(): void {
  const file = join(appDirectory('config'), 'settings.json')
  handle('settings:get', () => readSettings(file))
  handle('settings:set', (settings) => {
    writeSettings(file, settings)
    return null
  })
}
