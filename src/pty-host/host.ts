import { statSync } from 'node:fs'
import { spawn, type IPty } from 'node-pty'
import type { HostEvent, HostRequest } from '../shared/pty-protocol'
import { RingBuffer } from './ring-buffer'

type Terminal = { pty: IPty; buffer: RingBuffer; exited: boolean; closing: boolean; total: number }

const isDirectory = (path: string) => statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false

// shortcut: 1 M caractères par terminal (≈ 1 à 4 Mo) ; à rendre réglable si on garde beaucoup de terminaux ouverts
export function createHost(send: (event: HostEvent) => void, bufferSize = 1_000_000) {
  const terminals = new Map<string, Terminal>()
  const close = (id: string) => {
    terminals.delete(id)
    send({ type: 'closed', id })
  }
  // Chaque erreur dit quelle requête l'a causée : le main ne fait échouer que l'attente correspondante.
  const error = (req: HostRequest, message: string) =>
    send({ type: 'error', id: req.id, request: req.type, message })

  function spawnTerminal(req: Extract<HostRequest, { type: 'spawn' }>): void {
    if (terminals.has(req.id)) return error(req, `Terminal « ${req.id} » déjà ouvert`)
    if (!isDirectory(req.cwd)) return error(req, `Dossier introuvable : ${req.cwd}`)
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
      return error(req, `Lancement impossible de ${req.file} : ${(e as Error).message}`)
    }
    const term: Terminal = {
      pty,
      buffer: new RingBuffer(bufferSize),
      exited: false,
      closing: false,
      total: 0,
    }
    terminals.set(req.id, term)
    pty.onData((data) => {
      term.buffer.push(data)
      term.total += data.length
      send({ type: 'data', id: req.id, data, offset: term.total })
    })
    pty.onExit(({ exitCode, signal }) => {
      term.exited = true
      send({ type: 'exit', id: req.id, exitCode, signal: signal || null })
      if (term.closing) close(req.id) // fermé par l'utilisateur : plus personne ne rejouera ce tampon
    })
    send({ type: 'spawned', id: req.id, pid: pty.pid })
  }

  // Frontière de chaque requête : une exception (EACCES, PTY déjà fermé…) devient une erreur
  // de ce terminal, jamais un plantage du pty-host qui ferait perdre tous les autres.
  function handle(req: HostRequest): void {
    try {
      dispatch(req)
    } catch (e) {
      error(req, `Échec de « ${req.type} » : ${(e as Error).message}`)
    }
  }

  function dispatch(req: HostRequest): void {
    if (req.type === 'spawn') return spawnTerminal(req)
    const term = terminals.get(req.id)
    if (!term) return error(req, `Terminal « ${req.id} » inconnu`)
    switch (req.type) {
      case 'replay':
        return send({ type: 'replay', id: req.id, data: term.buffer.read(), offset: term.total })
      case 'kill':
        if (term.exited) close(req.id)
        else {
          term.closing = true
          term.pty.kill()
        }
        return
      case 'pause':
        return term.pty.pause()
      case 'resume':
        return term.pty.resume()
      case 'write':
      case 'resize':
        if (term.exited) return error(req, `Terminal « ${req.id} » déjà terminé`)
        if (req.type === 'write') term.pty.write(req.data)
        else term.pty.resize(req.cols, req.rows)
    }
  }

  return { handle }
}
