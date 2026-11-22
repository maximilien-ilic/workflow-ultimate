import { statSync } from 'node:fs'
import { spawn, type IPty } from 'node-pty'
import type { HostEvent, HostRequest } from '../shared/pty-protocol'
import { RingBuffer } from './ring-buffer'

type Terminal = { pty: IPty; buffer: RingBuffer; exited: boolean }

const isDirectory = (path: string) => statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false

// shortcut: 1 M caractères par terminal (≈ 1 à 4 Mo) ; à rendre réglable si on garde beaucoup de terminaux ouverts
export function createHost(send: (event: HostEvent) => void, bufferSize = 1_000_000) {
  const terminals = new Map<string, Terminal>()
  const error = (id: string, message: string) => send({ type: 'error', id, message })

  function spawnTerminal(req: Extract<HostRequest, { type: 'spawn' }>): void {
    if (terminals.has(req.id)) return error(req.id, `Terminal « ${req.id} » déjà ouvert`)
    if (!isDirectory(req.cwd)) return error(req.id, `Dossier introuvable : ${req.cwd}`)
    let pty: IPty
    try {
      pty = spawn(req.file, req.args, {
        name: 'xterm-256color',
        cwd: req.cwd,
        env: req.env,
        cols: req.cols,
        rows: req.rows,
      })
    } catch (e) {
      return error(req.id, `Lancement impossible de ${req.file} : ${(e as Error).message}`)
    }
    const term: Terminal = { pty, buffer: new RingBuffer(bufferSize), exited: false }
    terminals.set(req.id, term)
    pty.onData((data) => {
      term.buffer.push(data)
      send({ type: 'data', id: req.id, data })
    })
    pty.onExit(({ exitCode, signal }) => {
      term.exited = true
      send({ type: 'exit', id: req.id, exitCode, signal: signal || null })
    })
  }

  function handle(req: HostRequest): void {
    if (req.type === 'spawn') return spawnTerminal(req)
    const term = terminals.get(req.id)
    if (!term) return error(req.id, `Terminal « ${req.id} » inconnu`)
    switch (req.type) {
      case 'replay':
        return send({ type: 'replay', id: req.id, data: term.buffer.read() })
      case 'kill':
        if (term.exited) terminals.delete(req.id)
        else term.pty.kill()
        return
      case 'pause':
        return term.pty.pause()
      case 'resume':
        return term.pty.resume()
      case 'write':
      case 'resize':
        if (term.exited) return error(req.id, `Terminal « ${req.id} » déjà terminé`)
        if (req.type === 'write') term.pty.write(req.data)
        else term.pty.resize(req.cols, req.rows)
    }
  }

  return { handle }
}
