import { mkdirSync, readFileSync, readlinkSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { z } from 'zod'
import {
  terminalHistorySchema,
  terminalLayoutSchema,
  type TerminalHistory,
  type TerminalLayout,
} from '../../../shared/ipc'
import { paneIds } from '../../../shared/terminal-history'
import { handle } from '../shell/ipc'
import type { registerTerminalHandlers } from './ipc'

const PRIVATE_FILE_MODE = 0o600
const PRIVATE_DIRECTORY_MODE = 0o700
const CLOSE_TIMEOUT_MS = 3_000

function readSaved<T>(path: string, schema: z.ZodType<T>): T | undefined {
  try {
    return schema.parse(JSON.parse(readFileSync(path, 'utf8')))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      console.error(`Fichier de terminaux illisible : ${path}`)
    return undefined
  }
}

function writeSaved(path: string, value: TerminalLayout | TerminalHistory) {
  const temporary = `${path}.tmp`
  mkdirSync(dirname(path), { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
  // Un arrêt pendant l'écriture laisse la version précédente lisible.
  rmSync(temporary, { force: true })
  try {
    writeFileSync(temporary, JSON.stringify(value), { mode: PRIVATE_FILE_MODE, flag: 'wx' })
    renameSync(temporary, path)
  } finally {
    rmSync(temporary, { force: true })
  }
}

function paneDirectories({ tabs }: TerminalLayout): Map<string, string> {
  return new Map(tabs.flatMap((tab) => paneIds(tab.tree).map((id) => [id, tab.cwd])))
}

function currentDirectory(pid: number | undefined): string | undefined {
  if (!pid) return
  try {
    const cwd = readlinkSync(`/proc/${pid}/cwd`)
    if (directoryExists(cwd)) return cwd
  } catch {
    // Un shell peut se terminer entre la lecture du PID et celle de son dossier.
  }
}

function directoryExists(cwd: string): boolean {
  try {
    return statSync(cwd, { throwIfNoEntry: false })?.isDirectory() ?? false
  } catch {
    return false
  }
}

function readHistories(file: (id: string) => string, panes: Map<string, string>) {
  const restored = new Map<string, TerminalHistory>()
  for (const [id, cwd] of panes) {
    const saved = readSaved(file(id), terminalHistorySchema)
    if (saved) restored.set(id, { ...saved, cwd: directoryExists(saved.cwd) ? saved.cwd : cwd })
  }
  return restored
}

export function registerTerminalHistory(
  directory: string,
  terminals: Pick<ReturnType<typeof registerTerminalHandlers>, 'isOpen' | 'processId'>,
) {
  const layoutFile = join(directory, 'layout.json')
  const historyFile = (id: string) => join(directory, `${id}.json`)
  let layout = readSaved(layoutFile, terminalLayoutSchema) ?? { tabs: [], activeTab: null }
  let panes = paneDirectories(layout)
  const lastDirectories = new Map<string, string>()
  // Le rejeu du renderer ajoute le flux du PTY courant à cette base fixe, y compris après un split.
  const restored = readHistories(historyFile, panes)

  handle('terminal:workspace', (_, { sender }) => ({
    layout,
    livePanes: [...panes.keys()].filter((id) => terminals.isOpen(id, sender)),
    historyPanes: [...restored.keys()],
  }))
  handle('terminal:loadHistory', ({ id }) => restored.get(id) ?? null)
  handle('terminal:saveLayout', (next) => {
    const nextPanes = paneDirectories(next)
    const removed = [...panes.keys()].filter((id) => !nextPanes.has(id))
    layout = next
    panes = nextPanes
    for (const id of removed) {
      restored.delete(id)
      lastDirectories.delete(id)
      rmSync(historyFile(id), { force: true })
      rmSync(`${historyFile(id)}.tmp`, { force: true })
    }
    writeSaved(layoutFile, layout)
    return null
  })
  handle('terminal:saveHistory', ({ id, ...screen }) => {
    const originalDirectory = panes.get(id)
    if (!originalDirectory) return null // Un instantané en vol peut arriver après la fermeture du volet.
    const cwd =
      currentDirectory(terminals.processId(id)) ??
      lastDirectories.get(id) ??
      restored.get(id)?.cwd ??
      originalDirectory
    writeSaved(historyFile(id), { ...screen, cwd })
    lastDirectories.set(id, cwd)
    return null
  })

  return (window: BrowserWindow) => flushBeforeClose(window, () => panes.size > 0)
}

function flushBeforeClose(window: BrowserWindow, hasPanes: () => boolean) {
  let finishFlush: (() => void) | undefined
  let flushed = false
  window.on('close', (event) => {
    if (flushed || !hasPanes() || window.webContents.isCrashed()) return
    event.preventDefault()
    if (finishFlush) return
    const timeout = setTimeout(() => finishFlush?.(), CLOSE_TIMEOUT_MS)
    finishFlush = () => {
      clearTimeout(timeout)
      finishFlush = undefined
      flushed = true
      window.close()
    }
    window.webContents.send('terminal:flush-history')
  })
  handle('terminal:historyFlushed', (_, { sender }) => {
    if (sender === window.webContents) finishFlush?.()
    return null
  })
}
