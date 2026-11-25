import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { AgentSessions } from './sessions'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (event: unknown, raw: unknown) => Promise<unknown>>()
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: never) => handlers.set(channel, fn) },
  app: { isPackaged: true },
  BrowserWindow: class {},
}))
const { registerAgentHandlers } = await import('./sessions')
const { openDatabase } = await import('../shell/db')
const { migrations } = await import('../shell/migrations')
const { rendererUrl } = await import('../shell/window')

const event = {
  sender: { send: vi.fn(), isDestroyed: () => false },
  senderFrame: { url: rendererUrl(), parent: null },
}
const call = (channel: string, req: unknown) => handlers.get(channel)!(event, req)
const size = { cols: 80, rows: 24 }

let dir: string
let db: DatabaseSync
const spawn = vi.fn()
const writeConfirmed = vi.fn()
let agents: AgentSessions
beforeEach(() => {
  handlers.clear()
  spawn.mockReset()
  writeConfirmed.mockReset()
  dir = mkdtempSync(join(tmpdir(), 'wu-sessions-'))
  db = openDatabase(join(dir, 'app.db'), migrations)
  agents = registerAgentHandlers(db, { spawn, writeConfirmed, onExit: () => {} } as never, {
    notify: { node: '/n', script: '/s' },
    socketPath: '/tmp/x.sock',
    bins: { 'claude-code': 'claude', codex: 'codex' },
  })
})

it('remet un message de revue uniquement à un agent disponible dans le même worktree', async () => {
  spawn.mockResolvedValue(1)
  const terminalId = crypto.randomUUID()
  const session = (await call('agents:start', { terminalId, cwd: dir, agent: 'claude-code', ...size })) as { id: string }
  const owner = event.sender as never
  const message = 'Commentaires'
  await expect(agents.writeReview(session.id, dir, owner, message)).rejects.toThrow(/agent disponible/)
  const hook = { agent: 'claude-code' as const, sessionId: session.id, ts: Date.now() }
  agents.onSocketEvent({ ...hook, event: { type: 'prompt-submitted' } })
  agents.onSocketEvent({ ...hook, event: { type: 'turn-finished' } })
  await expect(agents.writeReview(session.id, '/autre', owner, message)).rejects.toThrow(/agent disponible/)
  await expect(agents.writeReview(session.id, dir, {} as never, message)).rejects.toThrow(/agent disponible/)
  expect(writeConfirmed).not.toHaveBeenCalled()
  await agents.writeReview(session.id, dir, owner, message)
  expect(writeConfirmed).toHaveBeenCalledExactlyOnceWith(terminalId, owner, message)
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('sessions refusées par le PTY', () => {
  it('un lancement refusé ne laisse aucune session en base', async () => {
    spawn.mockRejectedValue(new Error('Dossier introuvable'))
    const start = { terminalId: crypto.randomUUID(), cwd: '/supprime', agent: 'claude-code', ...size }
    await expect(call('agents:start', start)).rejects.toThrow('Dossier introuvable')
    expect(await call('agents:list', {})).toEqual([])
  })

  it('une reprise refusée garde le dernier état connu et reste possible', async () => {
    spawn.mockResolvedValueOnce(1)
    const session = (await call('agents:start', {
      terminalId: crypto.randomUUID(),
      cwd: dir,
      agent: 'claude-code',
      ...size,
    })) as { id: string }
    db.prepare("UPDATE agent_sessions SET state = 'done', updated_at = 42 WHERE id = ?").run(session.id)
    // Le processus est fini (sinon la reprise serait refusée comme « déjà ouverte »).
    handlers.clear()
    registerAgentHandlers(db, { spawn, onExit: () => {} } as never, {
      notify: { node: '/n', script: '/s' },
      socketPath: '/tmp/x.sock',
      bins: { 'claude-code': 'claude', codex: 'codex' },
    })

    spawn.mockRejectedValueOnce(new Error('Dossier introuvable'))
    const resume = { sessionId: session.id, terminalId: crypto.randomUUID(), ...size }
    await expect(call('agents:resume', resume)).rejects.toThrow('Dossier introuvable')
    expect(await call('agents:list', {})).toMatchObject([{ id: session.id, state: 'done', updatedAt: 42 }])

    spawn.mockResolvedValueOnce(2)
    await expect(
      call('agents:resume', { ...resume, terminalId: crypto.randomUUID() }),
    ).resolves.toMatchObject({
      id: session.id,
    })
  })
})
