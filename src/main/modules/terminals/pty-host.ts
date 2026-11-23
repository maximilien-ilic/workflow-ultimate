import { utilityProcess, type UtilityProcess } from 'electron'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import type { HostEvent, HostRequest } from '../../../shared/pty-protocol'

const WINDOW_MS = 60_000
const MAX_CRASHES = 5

// Évite une boucle de redémarrages si le pty-host plante dès son lancement.
export function shouldRestart(crashes: number[], now: number): boolean {
  return crashes.filter((t) => now - t < WINDOW_MS).length < MAX_CRASHES
}

export type PtyHost = {
  send(req: HostRequest): void
  events: EventEmitter<{ event: [HostEvent]; restarted: []; gaveUp: [] }>
  stop(): void
}

export function startPtyHost(entry = join(__dirname, 'pty-host.js')): PtyHost {
  const events: PtyHost['events'] = new EventEmitter()
  const crashes: number[] = []
  let stopping = false
  let child: UtilityProcess

  const start = () => {
    child = utilityProcess.fork(entry, [], { serviceName: 'workflow-ultimate-pty-host' })
    child.on('message', (event: HostEvent) => events.emit('event', event))
    // Erreur fatale signalée par Electron pour ce processus : on la journalise, l'arrêt suit sur 'exit'.
    child.on('error', (type, location) => console.error(`pty-host : erreur fatale ${type} (${location})`))
    child.on('exit', (code) => {
      if (stopping) return
      if (!shouldRestart(crashes, Date.now())) {
        console.error('pty-host : trop de plantages en une minute, abandon')
        events.emit('gaveUp')
        return
      }
      crashes.push(Date.now())
      // Les PTY vivaient dans le processus mort : ils sont perdus, l'interface doit le signaler.
      console.error(`pty-host arrêté (code ${code}), redémarrage ; les terminaux ouverts sont perdus`)
      start()
      events.emit('restarted')
    })
  }
  start()

  return {
    send: (req) => child.postMessage(req),
    events,
    stop: () => {
      stopping = true
      child.kill()
    },
  }
}
