import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { TerminalLayout } from '../../../shared/ipc'
import { registerTerminalHistory } from './history'

type Handler = (request: unknown, event: { sender?: unknown }) => unknown
const handlers = vi.hoisted(() => new Map<string, Handler>())
vi.mock('../shell/ipc', () => ({
  handle: (channel: string, handler: Handler) => handlers.set(channel, handler),
}))

const pane = '3b241101-e2bb-4255-8caf-4136c566a962'
const orphan = '45e16be1-e7ee-4554-8509-e25498772003'
const tab = '9c858901-8a57-4791-81fe-4c455b099bc9'
const empty: TerminalLayout = { tabs: [], activeTab: null }
const layout: TerminalLayout = {
  tabs: [{ id: tab, title: 'Terminal', cwd: '/tmp', tree: { type: 'pane', id: pane }, activePane: pane }],
  activeTab: tab,
}
const screen = { data: 'historique', cols: 80, rows: 24 }
const call = (channel: string, request: unknown = {}, sender?: unknown) =>
  handlers.get(`terminal:${channel}`)!(request, { sender })

let temporary: string
let directory: string
const file = (name: string) => join(directory, name)
const start = () => registerTerminalHistory(directory, { isOpen: () => false, processId: () => undefined })

beforeEach(() => {
  temporary = mkdtempSync(join(tmpdir(), 'wu-history-'))
  directory = join(temporary, 'history')
  handlers.clear()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  rmSync(temporary, { force: true, recursive: true })
})

it.each(['{"data":', '{"data":42}'])('ignore un instantané illisible : %s', (contents) => {
  mkdirSync(directory)
  writeFileSync(file('layout.json'), JSON.stringify(layout))
  writeFileSync(file(`${pane}.json`), contents)
  start()

  expect(call('workspace')).toEqual({ layout, livePanes: [], historyPanes: [] })
  expect(call('loadHistory', { id: pane })).toBeNull()
})

it('supprime les fichiers orphelins au démarrage et garde les historiques associés', () => {
  mkdirSync(directory)
  writeFileSync(file('layout.json'), JSON.stringify(layout))
  writeFileSync(file(`${pane}.json`), JSON.stringify({ ...screen, cwd: '/tmp' }))
  for (const name of [`${orphan}.json`, `${orphan}.json.tmp`, `${orphan}.tmp`])
    writeFileSync(file(name), 'orphelin')

  start()

  expect(call('loadHistory', { id: pane })).toEqual({ ...screen, cwd: '/tmp' })
  expect(existsSync(file('layout.json'))).toBe(true)
  for (const name of [`${orphan}.json`, `${orphan}.json.tmp`, `${orphan}.tmp`])
    expect(existsSync(file(name))).toBe(false)
})

it('repart sans volet et purge les historiques lorsque la disposition est tronquée', () => {
  mkdirSync(directory)
  writeFileSync(file('layout.json'), '{"tabs":')
  writeFileSync(file(`${pane}.json`), JSON.stringify({ ...screen, cwd: '/tmp' }))

  start()

  expect(call('workspace')).toEqual({ layout: empty, livePanes: [], historyPanes: [] })
  expect(existsSync(file(`${pane}.json`))).toBe(false)
})

it('ignore une sauvegarde pour un volet inconnu sans créer le dossier', () => {
  start()
  expect(call('saveHistory', { id: pane, ...screen })).toBeNull()
  expect(existsSync(directory)).toBe(false)
})

it('protège le dossier en 0700 et efface les fichiers du volet retiré', () => {
  start()
  call('saveLayout', layout)
  call('saveHistory', { id: pane, ...screen })
  const snapshot = file(`${pane}.json`)
  const unfinished = file(`${pane}.json.tmp`)
  const temporarySnapshot = file(`${pane}.tmp`)
  writeFileSync(unfinished, 'instantané incomplet')
  writeFileSync(temporarySnapshot, 'instantané incomplet')

  expect(statSync(directory).mode & 0o777).toBe(0o700)
  expect(statSync(snapshot).mode & 0o777).toBe(0o600)
  call('saveLayout', empty)
  call('saveHistory', { id: pane, ...screen })
  expect(existsSync(snapshot)).toBe(false)
  expect(existsSync(unfinished)).toBe(false)
  expect(existsSync(temporarySnapshot)).toBe(false)
})

function openWindow(crashed = false) {
  vi.useFakeTimers()
  const webContents = { send: vi.fn(), isCrashed: () => crashed }
  const window = Object.assign(new EventEmitter(), { webContents, close: vi.fn() })
  start()(window as unknown as BrowserWindow)
  call('saveLayout', layout)
  const event = { preventDefault: vi.fn() }
  window.emit('close', event)
  return { window, event, webContents }
}

it('laisse trois secondes au renderer avant de fermer la fenêtre', () => {
  const { window, event, webContents } = openWindow()
  expect(event.preventDefault).toHaveBeenCalledOnce()
  expect(webContents.send).toHaveBeenCalledWith('terminal:flush-history')
  vi.advanceTimersByTime(2_999)
  expect(window.close).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1)
  expect(window.close).toHaveBeenCalledOnce()
})

it('laisse la fenêtre se fermer immédiatement si le renderer est planté', () => {
  const { event, webContents } = openWindow(true)
  expect(event.preventDefault).not.toHaveBeenCalled()
  expect(webContents.send).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})

it('attend la confirmation du webContents de la fenêtre', () => {
  const { window, webContents } = openWindow()
  call('historyFlushed', {}, { ...webContents })
  expect(window.close).not.toHaveBeenCalled()
  call('historyFlushed', {}, webContents)
  expect(window.close).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})
