import { createHash } from 'node:crypto'
import { chmodSync, lstatSync, unlinkSync } from 'node:fs'
import { mkdir, realpath, stat } from 'node:fs/promises'
import { createConnection, createServer, type Server, type Socket } from 'node:net'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { z } from 'zod'
import type { AgentEvent } from './state'

const maxLineBytes = 64 * 1024
const agentKind = z.enum(['claude-code', 'codex'])
const event = z.union([
  z.strictObject({ type: z.enum(['prompt-submitted', 'needs-input', 'turn-finished', 'error']) }),
  z.strictObject({ type: z.literal('pty-exit'), code: z.number().int().nullable() }),
]) satisfies z.ZodType<AgentEvent>
const envelope = z.strictObject({
  sessionId: z.uuid(),
  agent: agentKind,
  event,
  ts: z.number().int().nonnegative(),
  externalId: z.uuid().optional(),
})

export type AgentKind = z.output<typeof agentKind>
export type AgentSocketEvent = z.output<typeof envelope>
export type AgentSocket = { path: string; close: () => Promise<void> }

type SocketOptions = {
  path?: string
  sessionAgent: (sessionId: string) => AgentKind | undefined
  onEvent: (event: AgentSocketEvent) => void
  warn?: (message: string) => void
}

const errno = (error: unknown) => (error as NodeJS.ErrnoException).code

export async function agentSocketPath(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): Promise<string> {
  const runtime = env['XDG_RUNTIME_DIR']
  if (runtime && isAbsolute(runtime)) {
    try {
      if ((await stat(runtime)).isDirectory()) return join(runtime, 'workflow-ultimate.sock')
    } catch (error) {
      if (errno(error) !== 'ENOENT') throw error
    }
  }

  const state = env['XDG_STATE_HOME']
  return join(state && isAbsolute(state) ? state : join(home, '.local/state'), 'workflow-ultimate/agent.sock')
}

function listen(server: Server, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(path, () => {
      server.off('error', reject)
      resolve()
    })
  })
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
}

function isListening(path: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const client = createConnection(path)
    const timer = setTimeout(() => {
      client.destroy()
      reject(new Error(`L’état du socket ${path} est indéterminé`))
    }, 350)

    client.once('connect', () => {
      clearTimeout(timer)
      client.destroy()
      resolve(true)
    })
    client.once('error', (error) => {
      clearTimeout(timer)
      if (errno(error) === 'ECONNREFUSED') resolve(false)
      else reject(error)
    })
  })
}

async function removeStaleSocket(path: string): Promise<void> {
  try {
    const previous = lstatSync(path)
    if (!previous.isSocket() || previous.uid !== process.getuid?.()) {
      throw new Error(`Le chemin ${path} est occupé par un fichier qui n’est pas notre socket`)
    }
    if (await isListening(path)) throw new Error(`Le socket ${path} est déjà utilisé`)

    const current = lstatSync(path)
    if (current.dev !== previous.dev || current.ino !== previous.ino) {
      throw new Error(`Le socket ${path} a changé pendant la vérification`)
    }
    unlinkSync(path)
  } catch (error) {
    if (errno(error) !== 'ENOENT') throw error
  }
}

function acceptLines(client: Socket, onLine: (line: string) => void, warn: (message: string) => void): void {
  let fragments: Buffer[] = []
  let bytes = 0
  let discarding = false
  client.on('data', (chunk: Buffer) => {
    let start = 0
    while (start < chunk.length) {
      const newline = chunk.indexOf(10, start)
      const end = newline === -1 ? chunk.length : newline
      if (!discarding) {
        bytes += end - start
        if (bytes > maxLineBytes) {
          warn('Ligne du socket agents trop longue (maximum 64 Kio)')
          fragments = []
          discarding = true
        } else if (end > start) {
          fragments.push(chunk.subarray(start, end))
        }
      }
      if (newline === -1) break
      if (!discarding) onLine(Buffer.concat(fragments, bytes).toString('utf8'))
      fragments = []
      bytes = 0
      discarding = false
      start = newline + 1
    }
  })
  client.on('error', () => warn('Erreur de connexion au socket agents'))
}

export async function startAgentSocket(options: SocketOptions): Promise<AgentSocket> {
  const path = options.path ?? (await agentSocketPath())
  const warn = options.warn ?? console.warn
  if (!isAbsolute(path) || Buffer.byteLength(path) > 107) {
    throw new Error('Chemin du socket agents invalide (absolu, 107 octets au plus)')
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const directory = await realpath(dirname(path))
  const directoryInfo = await stat(directory)
  if (directoryInfo.uid !== process.getuid?.() || (directoryInfo.mode & 0o077) !== 0) {
    throw new Error(
      `Le dossier du socket agents doit être privé et appartenir à l’utilisateur (${directory})`,
    )
  }
  const endpoint = join(directory, basename(path))
  if (Buffer.byteLength(endpoint) > 107) throw new Error('Chemin réel du socket agents trop long')

  const clients = new Set<Socket>()
  const server = createServer((client) => {
    clients.add(client)
    client.on('close', () => clients.delete(client))
    acceptLines(
      client,
      (line) => {
        let raw: unknown
        try {
          raw = JSON.parse(line)
        } catch {
          warn('JSON invalide sur le socket agents')
          return
        }
        const parsed = envelope.safeParse(raw)
        if (!parsed.success) {
          warn('Événement invalide sur le socket agents')
          return
        }

        const event = parsed.data
        if (options.sessionAgent(event.sessionId) !== event.agent) {
          warn('Événement du socket agents ignoré (session inconnue ou agent différent)')
          return
        }
        options.onEvent(event)
      },
      warn,
    )
  })

  let closing: Promise<void> | undefined
  const stop = () => {
    if (closing) return closing
    closing = close(server)
    for (const client of clients) client.destroy()
    return closing
  }

  // Verrou de démarrage Linux sans fichier, libéré même si un processus plante.
  const lockName = '\0workflow-ultimate-agent-start-' + createHash('sha256').update(endpoint).digest('hex')
  const lock = createServer((client) => client.destroy())
  await listen(lock, lockName)
  try {
    try {
      await listen(server, endpoint)
    } catch (error) {
      if (errno(error) !== 'EADDRINUSE') throw error
      await removeStaleSocket(endpoint)
      await listen(server, endpoint)
    }

    server.on('error', () => warn('Erreur du serveur de socket agents'))
    try {
      chmodSync(endpoint, 0o600)
    } catch (error) {
      await stop()
      throw error
    }
  } finally {
    await close(lock)
  }

  return { path, close: stop }
}
