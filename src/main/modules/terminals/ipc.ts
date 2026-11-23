import type { WebContents } from 'electron'
import type { HostEvent } from '../../../shared/pty-protocol'
import type { TerminalEvent } from '../../../shared/ipc'
import { handle } from '../shell/ipc'
import { FlowControl } from './flow-control'
import { Pending } from './pending'
import type { PtyHost } from './pty-host'

// Variables git qui redirigent vers un autre dépôt : le shell d'un worktree doit voir son propre dépôt.
const GIT_REDIRECTS = new Set([
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_NAMESPACE',
  'GIT_PREFIX',
])

// Variables qu'un shell ne doit pas hériter d'Electron (sinon `node` ou `electron` lancés dedans se comportent mal),
// ni du lancement de l'appli (redirections git).
export function shellEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const clean: Record<string, string> = {}
  for (const [key, value] of Object.entries(env))
    if (
      value !== undefined &&
      !key.startsWith('ELECTRON_') &&
      key !== 'CHROME_DESKTOP' &&
      !GIT_REDIRECTS.has(key)
    )
      clean[key] = value
  return { ...clean, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'workflow-ultimate' }
}

export type SpawnSpec = {
  id: string
  owner: WebContents
  cwd: string
  file: string
  args: string[]
  env: Record<string, string>
  cols: number
  rows: number
}

// Lancement d'un processus dans un terminal (shell ou agent) ; `onExit` permet aux agents de suivre la fin.
export type Terminals = {
  spawn(spec: SpawnSpec): Promise<number>
  onExit(listener: (id: string, exitCode: number) => void): void
}

export function registerTerminalHandlers(host: PtyHost): Terminals {
  const exitListeners: ((id: string, exitCode: number) => void)[] = []
  const owners = new Map<string, WebContents>() // terminal → fenêtre qui reçoit sa sortie
  const flow = new FlowControl()
  const replays = new Pending<{ data: string; offset: number }>()
  const closing = new Set<string>() // fermés par le renderer : oubliés dès la fin du processus
  const spawns = new Pending<number>()

  const sendTo = (id: string, event: TerminalEvent) => {
    const owner = owners.get(id)
    if (owner && !owner.isDestroyed()) owner.send('terminal:event', event)
  }

  host.events.on('event', (event: HostEvent) => {
    if (event.type === 'replay') return replays.settle(event.id, { data: event.data, offset: event.offset })
    if (event.type === 'spawned') return spawns.settle(event.id, event.pid)
    if (event.type === 'error') {
      spawns.fail(event.id, new Error(event.message))
      replays.fail(event.id, new Error(event.message))
    }
    if (event.type === 'data' && flow.onData(event.id, event.data.length) === 'pause')
      host.send({ type: 'pause', id: event.id })
    if (event.type === 'exit') {
      flow.forget(event.id)
      for (const listener of exitListeners) listener(event.id, event.exitCode)
    }
    sendTo(event.id, event)
    if (event.type === 'exit' && closing.delete(event.id)) owners.delete(event.id)
  })
  host.events.on('restarted', () => {
    const lost = new Error('pty-host redémarré : terminal perdu')
    spawns.failAll(lost)
    replays.failAll(lost)
    for (const owner of new Set(owners.values()))
      if (!owner.isDestroyed())
        owner.send('terminal:event', { type: 'host-restarted' } satisfies TerminalEvent)
    owners.clear()
  })

  const owned = (id: string, sender: WebContents) => {
    if (owners.get(id) !== sender) throw new Error(`Terminal ${id} inconnu`)
  }

  async function spawn({ id, owner, ...process }: SpawnSpec): Promise<number> {
    if (owners.has(id)) throw new Error(`Terminal ${id} déjà ouvert`)
    owners.set(id, owner)
    const spawned = spawns.wait(id, 5000)
    host.send({ type: 'spawn', id, ...process })
    try {
      return await spawned
    } catch (error) {
      owners.delete(id) // échec du lancement : l'id est libéré, pas de faux succès
      throw error
    }
  }

  handle('terminal:create', async ({ id, cwd, cols, rows }, event) => {
    const file = process.env['SHELL'] || '/bin/bash'
    const pid = await spawn({ id, owner: event.sender, cwd, file, args: [], env: shellEnv(), cols, rows })
    return { pid }
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
    closing.add(id)
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
    // Nouveau renderer : les accusés de l'ancien sont perdus, on repart de zéro et on relance la lecture.
    flow.forget(id)
    host.send({ type: 'resume', id })
    const replay = replays.wait(id, 5000)
    host.send({ type: 'replay', id })
    return replay
  })

  return { spawn, onExit: (listener) => void exitListeners.push(listener) }
}
