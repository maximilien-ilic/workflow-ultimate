import type { WebContents } from 'electron'
import type { HostEvent } from '../../../shared/pty-protocol'
import type { TerminalEvent } from '../../../shared/ipc'
import { handle } from '../shell/ipc'
import { FlowControl } from './flow-control'
import type { PtyHost } from './pty-host'

// Variables qu'un shell ne doit pas hériter d'Electron (sinon `node` ou `electron` lancés dedans se comportent mal).
export function shellEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const clean: Record<string, string> = {}
  for (const [key, value] of Object.entries(env))
    if (value !== undefined && !key.startsWith('ELECTRON_') && key !== 'CHROME_DESKTOP') clean[key] = value
  return { ...clean, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'workflow-ultimate' }
}

export function registerTerminalHandlers(host: PtyHost): void {
  // shortcut: une entrée par terminal, jamais libérée (quelques octets) ; à nettoyer quand les onglets (#14) fermeront leurs terminaux
  const owners = new Map<string, WebContents>() // terminal → fenêtre qui reçoit sa sortie
  const flow = new FlowControl()
  const replays = new Map<string, (data: string) => void>()

  const sendTo = (id: string, event: TerminalEvent) => {
    const owner = owners.get(id)
    if (owner && !owner.isDestroyed()) owner.send('terminal:event', event)
  }

  host.events.on('event', (event: HostEvent) => {
    if (event.type === 'replay') {
      replays.get(event.id)?.(event.data)
      replays.delete(event.id)
      return
    }
    if (event.type === 'data' && flow.onData(event.id, event.data.length) === 'pause')
      host.send({ type: 'pause', id: event.id })
    if (event.type === 'exit') flow.forget(event.id)
    sendTo(event.id, event)
  })
  host.events.on('restarted', () => {
    for (const owner of new Set(owners.values()))
      if (!owner.isDestroyed())
        owner.send('terminal:event', { type: 'host-restarted' } satisfies TerminalEvent)
    owners.clear()
  })

  const owned = (id: string, sender: WebContents) => {
    if (owners.get(id) !== sender) throw new Error(`Terminal ${id} inconnu`)
  }

  handle('terminal:create', ({ id, cwd, cols, rows }, event) => {
    if (owners.has(id)) throw new Error(`Terminal ${id} déjà ouvert`)
    owners.set(id, event.sender)
    const shell = process.env['SHELL'] || '/bin/bash'
    host.send({ type: 'spawn', id, file: shell, args: [], cwd, env: shellEnv(), cols, rows })
    return null
  })
  handle('terminal:write', ({ id, data }, event) => {
    owned(id, event.sender)
    host.send({ type: 'write', id, data })
    return null
  })
  handle('terminal:resize', ({ id, cols, rows }, event) => {
    owned(id, event.sender)
    host.send({ type: 'resize', id, cols, rows })
    return null
  })
  handle('terminal:kill', ({ id }, event) => {
    owned(id, event.sender)
    host.send({ type: 'kill', id })
    return null
  })
  handle('terminal:ack', ({ id, chars }, event) => {
    owned(id, event.sender)
    if (flow.onAck(id, chars) === 'resume') host.send({ type: 'resume', id })
    return null
  })
  handle('terminal:attach', ({ id }, event) => {
    owned(id, event.sender)
    // shortcut: un seul rejeu en attente par terminal ; deux attach simultanés partagent la réponse du dernier
    return new Promise<string>((resolve) => {
      replays.set(id, resolve)
      host.send({ type: 'replay', id })
    })
  })
}
