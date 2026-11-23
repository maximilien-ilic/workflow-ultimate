import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { WebContents } from 'electron'
import type { AgentEvent, AgentSession, AgentState } from '../../../shared/ipc'
import { handle } from '../shell/ipc'
import { shellEnv, type Terminals } from '../terminals/ipc'
import { claudeArgs, type NotifyTarget } from './claude-code'
import type { AgentKind, AgentSocketEvent } from './socket'
import { transitionAgent, type AgentEvent as StateEvent } from './state'

type Row = { id: string; agent: 'claude-code'; cwd: string; state: AgentState; updated_at: number }
type Live = { terminalId: string; owner: WebContents }

export type AgentSessions = {
  // Pour le socket : seule une session lancée dans cette exécution accepte des événements.
  sessionAgent(sessionId: string): AgentKind | undefined
  onSocketEvent(event: AgentSocketEvent): void
}

export function registerAgentHandlers(
  db: DatabaseSync,
  terminals: Terminals,
  opts: { notify: NotifyTarget; socketPath: string; claudeBin: string },
): AgentSessions {
  const live = new Map<string, Live>()
  const byTerminal = new Map<string, string>() // terminal → session

  const row = (id: string) =>
    db.prepare('SELECT * FROM agent_sessions WHERE id = ?').get(id) as Row | undefined
  const toSession = (r: Row): AgentSession => ({
    id: r.id,
    agent: r.agent,
    cwd: r.cwd,
    state: r.state,
    terminalId: live.get(r.id)?.terminalId ?? null,
    updatedAt: r.updated_at,
  })

  function apply(sessionId: string, event: StateEvent): void {
    const current = row(sessionId)
    const session = live.get(sessionId)
    if (!current || !session) return
    const { state, ignoredReason } = transitionAgent(current.state, event)
    if (ignoredReason) return console.warn(`agents : ${ignoredReason}`)
    if (state === current.state) return
    db.prepare('UPDATE agent_sessions SET state = ?, updated_at = ? WHERE id = ?').run(
      state,
      Date.now(),
      sessionId,
    )
    if (!session.owner.isDestroyed())
      session.owner.send('agent:event', {
        sessionId,
        terminalId: session.terminalId,
        state,
      } satisfies AgentEvent)
  }

  terminals.onExit((terminalId, exitCode) => {
    const sessionId = byTerminal.get(terminalId)
    if (sessionId) apply(sessionId, { type: 'pty-exit', code: exitCode })
  })

  async function launch(
    sessionId: string,
    resume: boolean,
    req: { terminalId: string; cwd: string; prompt?: string; cols: number; rows: number },
    owner: WebContents,
  ): Promise<AgentSession> {
    if (live.has(sessionId)) throw new Error(`Session ${sessionId} déjà ouverte`)
    live.set(sessionId, { terminalId: req.terminalId, owner })
    byTerminal.set(req.terminalId, sessionId)
    try {
      await terminals.spawn({
        id: req.terminalId,
        owner,
        cwd: req.cwd,
        file: opts.claudeBin,
        args: claudeArgs({ sessionId, resume, prompt: req.prompt, notify: opts.notify }),
        env: { ...shellEnv(), WU_SESSION_ID: sessionId, WU_AGENT_SOCKET: opts.socketPath },
        cols: req.cols,
        rows: req.rows,
      })
    } catch (error) {
      live.delete(sessionId)
      byTerminal.delete(req.terminalId)
      throw error
    }
    return toSession(row(sessionId)!)
  }

  handle('agents:start', ({ terminalId, cwd, prompt, cols, rows }, event) => {
    const id = randomUUID()
    const now = Date.now()
    db.prepare(
      "INSERT INTO agent_sessions (id, agent, cwd, state, created_at, updated_at) VALUES (?, 'claude-code', ?, 'starting', ?, ?)",
    ).run(id, cwd, now, now)
    return launch(id, false, { terminalId, cwd, prompt, cols, rows }, event.sender)
  })

  handle('agents:resume', ({ sessionId, terminalId, cols, rows }, event) => {
    const saved = row(sessionId)
    if (!saved) throw new Error(`Session ${sessionId} inconnue`)
    db.prepare("UPDATE agent_sessions SET state = 'starting', updated_at = ? WHERE id = ?").run(
      Date.now(),
      sessionId,
    )
    return launch(sessionId, true, { terminalId, cwd: saved.cwd, cols, rows }, event.sender)
  })

  handle('agents:list', () =>
    (db.prepare('SELECT * FROM agent_sessions ORDER BY updated_at DESC LIMIT 200').all() as Row[]).map(
      toSession,
    ),
  )

  return {
    sessionAgent: (id) => (live.has(id) ? row(id)?.agent : undefined),
    onSocketEvent: (e) => apply(e.sessionId, e.event),
  }
}
