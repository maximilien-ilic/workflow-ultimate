import { statSync, writeSync } from 'node:fs'
import { ReadStream } from 'node:tty'
import { spawn, type IPty } from 'node-pty'
import { CONFIRMED_WRITE_TIMEOUT_MS, type HostEvent, type HostRequest } from '../shared/pty-protocol'
import { RingBuffer } from './ring-buffer'

type WriteRequest = Extract<HostRequest, { type: 'write' }>
type PendingWrite = { request: WriteRequest; data: Buffer; offset: number; deadline?: number }

type Terminal = {
  pty: IPty
  fd: number
  socket: ReadStream
  writes: PendingWrite[]
  writeTimer?: ReturnType<typeof setTimeout>
  buffer: RingBuffer
  exited: boolean
  closing: boolean
  total: number
  killTimer?: ReturnType<typeof setTimeout>
}

const TERMINATION_GRACE_MS = 500
const WRITE_RETRY_MS = 5

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
    send({
      type: 'error', id: req.id, request: req.type, message,
      ...(req.type === 'write' && req.receipt ? { receipt: req.receipt } : {}),
    })

  function failWrites(term: Terminal, message: string): void {
    clearTimeout(term.writeTimer)
    term.writeTimer = undefined
    for (const { request } of term.writes.splice(0)) error(request, message)
  }

  function scheduleWrite(term: Terminal, delay = 0): void {
    term.writeTimer ??= setTimeout(() => {
      term.writeTimer = undefined
      const write = term.writes[0]
      if (!write) return
      if (term.socket.destroyed) return failWrites(term, 'Le PTY est fermé.')
      if (write.deadline !== undefined && performance.now() >= write.deadline)
        return failWrites(term, 'Délai d’écriture dans le PTY dépassé.')

      try {
        if (write.offset < write.data.length) {
          // Le master Linux est non bloquant. L’appel synchrone évite qu’une écriture déléguée
          // s’exécute après la fermeture du descripteur par le flux.
          write.offset += writeSync(term.fd, write.data, write.offset, write.data.length - write.offset)
        }
      } catch (cause) {
        const code = (cause as NodeJS.ErrnoException).code
        if (code === 'EAGAIN' || code === 'EINTR') return scheduleWrite(term, WRITE_RETRY_MS)
        return failWrites(term, `Écriture PTY impossible : ${String(cause)}`)
      }

      if (write.offset === write.data.length) {
        term.writes.shift()
        const { id, receipt } = write.request
        if (receipt) send({ type: 'written', id, receipt })
      }
      if (term.writes.length > 0) scheduleWrite(term)
    }, delay)
  }

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
    // shortcut: node-pty 1.1 n’expose pas de reçu d’écriture ; utiliser son master Unix
    // tant que son API publique ne permet pas de confirmer la fin d’un lot.
    const fd = 'fd' in pty ? pty.fd : undefined
    const socket = '_socket' in pty ? pty._socket : undefined
    if (typeof fd !== 'number' || !(socket instanceof ReadStream)) {
      pty.kill()
      return error(req, 'Descripteur d’écriture du PTY indisponible.')
    }
    const term: Terminal = {
      pty,
      fd,
      socket,
      writes: [],
      buffer: new RingBuffer(bufferSize),
      exited: false,
      closing: false,
      total: 0,
    }
    terminals.set(req.id, term)
    socket.once('close', () => failWrites(term, 'Le PTY a fermé pendant l’écriture.'))
    pty.onData((data) => {
      term.buffer.push(data)
      term.total += data.length
      send({ type: 'data', id: req.id, data, offset: term.total })
    })
    pty.onExit(({ exitCode, signal }) => {
      clearTimeout(term.killTimer)
      term.exited = true
      send({ type: 'exit', id: req.id, exitCode, signal: signal || null })
      if (term.closing) close(req.id) // fermé par l'utilisateur : plus personne ne rejouera ce tampon
    })
    send({ type: 'spawned', id: req.id, pid: pty.pid })
  }

  function killTerminal(request: Extract<HostRequest, { type: 'kill' }>): void {
    const terminal = terminals.get(request.id)
    if (!terminal) {
      if (request.expiredSpawn) return close(request.id)
      return error(request, `Terminal « ${request.id} » inconnu`)
    }
    if (terminal.exited) return close(request.id)
    terminal.closing = true
    failWrites(terminal, 'Le PTY ferme pendant l’écriture.')
    if (request.expiredSpawn && !terminal.killTimer) {
      // Personne ne peut fermer ce PTY à la main s'il survit au premier signal.
      terminal.killTimer = setTimeout(() => {
        try {
          terminal.pty.kill('SIGKILL')
        } catch (cause) {
          error(request, `Arrêt forcé impossible : ${String(cause)}`)
        }
      }, TERMINATION_GRACE_MS)
    }
    terminal.pty.kill()
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
    if (req.type === 'kill') return killTerminal(req)
    const term = terminals.get(req.id)
    if (!term) return error(req, `Terminal « ${req.id} » inconnu`)
    switch (req.type) {
      case 'replay':
        return send({ type: 'replay', id: req.id, data: term.buffer.read(), offset: term.total })
      case 'pause':
        return term.pty.pause()
      case 'resume':
        return term.pty.resume()
      case 'write':
      case 'resize':
        if (term.exited) return error(req, `Terminal « ${req.id} » déjà terminé`)
        if (req.type === 'write') {
          if (term.closing) return error(req, 'Le PTY est en cours de fermeture.')
          const deadline = req.receipt ? performance.now() + CONFIRMED_WRITE_TIMEOUT_MS : undefined
          term.writes.push({ request: req, data: Buffer.from(req.data), offset: 0, deadline })
          scheduleWrite(term)
        } else term.pty.resize(req.cols, req.rows)
    }
  }

  return { handle }
}
