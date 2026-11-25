import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import type { HostEvent } from '../../../shared/pty-protocol'
import type { TerminalEvent } from '../../../shared/ipc'
import { redirectsGitRepository } from '../projects/git-env'
import { handle } from '../shell/ipc'
import { FlowControl } from './flow-control'
import { Pending, PendingTimeout } from './pending'
import type { PtyHost } from './pty-host'

// Variables qu'un shell ne doit pas hériter d'Electron (sinon `node` ou `electron` lancés dedans se comportent mal),
// ni du lancement de l'appli (redirections git).
export function shellEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const clean: Record<string, string> = {}
  for (const [key, value] of Object.entries(env))
    if (
      value !== undefined &&
      !key.startsWith('ELECTRON_') &&
      key !== 'CHROME_DESKTOP' &&
      !redirectsGitRepository(key)
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
  writeConfirmed(id: string, owner: WebContents, data: string): Promise<void>
  onExit(listener: (id: string, exitCode: number) => void): void
}

export function registerTerminalHandlers(host: PtyHost): Terminals {
  const exitListeners: ((id: string, exitCode: number) => void)[] = []
  const owners = new Map<string, WebContents>() // terminal → fenêtre qui reçoit sa sortie
  const releasing = new Set<string>() // lancements expirés, en attente de fermeture confirmée
  const starting = new Set<string>() // lancements en cours (pas encore confirmés)
  const flow = new FlowControl()
  const replays = new Pending<{ data: string; offset: number }>()
  const spawns = new Pending<number>()
  const writes = new Pending<void>()

  const sendTo = (id: string, event: TerminalEvent) => {
    const owner = owners.get(id)
    if (owner && !owner.isDestroyed()) owner.send('terminal:event', event)
  }

  host.events.on('event', (event: HostEvent) => {
    if (event.type === 'written') return writes.settle(event.receipt, undefined)
    if (event.type === 'error' && event.receipt) return writes.fail(event.receipt, new Error(event.message))
    if (event.type === 'replay') return replays.settle(event.id, { data: event.data, offset: event.offset })
    if (event.type === 'spawned') return spawns.settle(event.id, event.pid)
    // Seule l'attente qui correspond à la requête en erreur échoue (une écriture ratée ne casse pas un rejeu).
    if (event.type === 'error' && event.request === 'spawn') spawns.fail(event.id, new Error(event.message))
    if (event.type === 'error' && event.request === 'replay') replays.fail(event.id, new Error(event.message))
    if (event.type === 'closed') {
      releasing.delete(event.id)
      owners.delete(event.id)
      flow.forget(event.id)
      return
    }
    if (!owners.has(event.id)) return
    if (event.type === 'data' && flow.onData(event.id, event.data.length) === 'pause')
      host.send({ type: 'pause', id: event.id })
    if (event.type === 'exit') {
      flow.forget(event.id)
      for (const listener of exitListeners) listener(event.id, event.exitCode)
    }
    sendTo(event.id, event)
  })
  // Perte du pty-host : tous ses PTY ont disparu. Attentes rejetées, fenêtres prévenues, et chaque terminal
  // signalé comme terminé (code -1) pour que les agents passent en erreur et restent reprenables.
  function hostLost(reason: string) {
    const lost = new Error(reason)
    spawns.failAll(lost)
    replays.failAll(lost)
    writes.failAll(lost)
    for (const owner of new Set(owners.values()))
      if (!owner.isDestroyed())
        owner.send('terminal:event', { type: 'host-restarted' } satisfies TerminalEvent)
    // Un lancement en cours échoue déjà par son attente : seuls les terminaux qui tournaient sont « terminés ».
    for (const id of owners.keys())
      if (!starting.has(id)) for (const listener of exitListeners) listener(id, -1)
    owners.clear()
    releasing.clear()
    flow.clear()
  }
  let unavailable = false
  host.events.on('restarted', () => hostLost('pty-host redémarré : terminal perdu'))
  host.events.on('gaveUp', () => {
    unavailable = true
    hostLost('pty-host arrêté après des plantages répétés : redémarrer l’appli')
  })

  const owned = (id: string, sender: WebContents) => {
    if (owners.get(id) !== sender) throw new Error(`Terminal ${id} inconnu`)
  }

  function writeConfirmed(id: string, owner: WebContents, data: string): Promise<void> {
    owned(id, owner)
    const receipt = randomUUID()
    const written = writes.wait(receipt, 5000)
    try {
      host.send({ type: 'write', id, data, receipt })
    } catch (cause) {
      writes.fail(receipt, new Error(`Écriture PTY impossible : ${String(cause)}`))
    }
    return written
  }

  async function spawn({ id, owner, ...process }: SpawnSpec): Promise<number> {
    if (owners.has(id)) throw new Error(`Terminal ${id} déjà ouvert`)
    if (releasing.has(id)) throw new Error(`Terminal ${id} en cours de fermeture, réessayer`)
    if (unavailable) throw new Error('pty-host indisponible (plantages répétés) : redémarrer l’appli')
    owners.set(id, owner)
    const spawned = spawns.wait(id, 5000)
    host.send({ type: 'spawn', id, ...process })
    starting.add(id)
    try {
      return await spawned
    } catch (error) {
      owners.delete(id) // échec du lancement : pas de faux succès
      if (error instanceof PendingTimeout) {
        // Le pty-host a pu lancer le PTY sans répondre à temps : on le ferme, et l'id reste réservé
        // jusqu'à la confirmation, pour qu'une relance ne récupère pas la réponse tardive du premier.
        releasing.add(id)
        host.send({ type: 'kill', id, expiredSpawn: true })
      }
      throw error
    } finally {
      starting.delete(id)
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

  return { spawn, writeConfirmed, onExit: (listener) => void exitListeners.push(listener) }
}
