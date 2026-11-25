import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { WebContents } from 'electron'
import type { AgentEvent, AgentSession, AgentState } from '../../../shared/ipc'
import { handle } from '../shell/ipc'
import { shellEnv, type Terminals } from '../terminals/ipc'
import { claudeArgs, type NotifyTarget } from './claude-code'
import { codexArgs } from './codex'
import type { AgentKind, AgentSocketEvent } from './socket'
import { transitionAgent, type AgentEvent as StateEvent } from './state'

type Identity = { id: string; agent: AgentKind; cwd: string; external_id: string | null }
type Row = Identity & { state: AgentState; updated_at: number }
type Live = { terminalId: string; owner: WebContents }

export type AgentSessions = {
  // Pour le socket : seule une session lancée dans cette exécution accepte des événements.
  sessionAgent(sessionId: string): AgentKind | undefined
  onSocketEvent(event: AgentSocketEvent): void
  writeReview(sessionId: string, cwd: string, owner: WebContents, message: string): Promise<void>
}

export function registerAgentHandlers(
  db: DatabaseSync,
  terminals: Terminals,
  opts: {
    notify: NotifyTarget
    socketPath: string
    bins: Record<AgentKind, string>
    onStateChange?: (session: AgentSession) => void
  },
): AgentSessions {
  const live = new Map<string, Live>()
  const byTerminal = new Map<string, string>() // terminal → session
  const pendingCodexIds = new Set<string>()

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
    if (current.agent === 'codex' && current.state === 'done' && event.type === 'turn-finished') return
    const { state, ignoredReason } = transitionAgent(current.state, event)
    if (ignoredReason) return console.warn(`agents : ${ignoredReason}`)
    if (state === current.state) return
    const updatedAt = Date.now()
    db.prepare('UPDATE agent_sessions SET state = ?, updated_at = ? WHERE id = ?').run(
      state,
      updatedAt,
      sessionId,
    )
    if (!session.owner.isDestroyed())
      session.owner.send('agent:event', {
        sessionId,
        terminalId: session.terminalId,
        state,
      } satisfies AgentEvent)
    opts.onStateChange?.(toSession({ ...current, state, updated_at: updatedAt }))
  }

  terminals.onExit((terminalId, exitCode) => {
    const sessionId = byTerminal.get(terminalId)
    if (!sessionId) return
    apply(sessionId, { type: 'pty-exit', code: exitCode })
    // Processus fini : la session n'est plus « ouverte » et peut être reprise (--resume).
    live.delete(sessionId)
    byTerminal.delete(terminalId)
    // Codex lance notify en arrière-plan : son dernier identifiant peut arriver après la sortie du PTY.
    if (pendingCodexIds.has(sessionId)) setTimeout(() => pendingCodexIds.delete(sessionId), 2500).unref()
  })

  async function launch(
    session: Identity,
    resume: boolean,
    req: { terminalId: string; prompt?: string; cols: number; rows: number },
    owner: WebContents,
  ): Promise<AgentSession> {
    const { id, agent, cwd, external_id: externalId } = session
    if (resume && agent === 'codex' && !externalId) throw new Error('Identifiant de thread Codex inconnu')
    if (live.has(id)) throw new Error(`Session ${id} déjà ouverte`)
    if (byTerminal.has(req.terminalId))
      throw new Error(`Terminal ${req.terminalId} déjà utilisé par un agent`)
    const args =
      agent === 'codex'
        ? codexArgs({
            resumeId: resume ? (externalId ?? undefined) : undefined,
            prompt: req.prompt,
            notify: opts.notify,
          })
        : claudeArgs({ sessionId: id, resume, prompt: req.prompt, notify: opts.notify })
    const now = Date.now()
    const before = resume ? row(id) : undefined // dernier état durable, restauré si le PTY refuse la reprise
    if (resume)
      db.prepare("UPDATE agent_sessions SET state = 'starting', updated_at = ? WHERE id = ?").run(now, id)
    else
      db.prepare(
        "INSERT INTO agent_sessions (id, agent, cwd, state, created_at, updated_at) VALUES (?, ?, ?, 'starting', ?, ?)",
      ).run(id, agent, cwd, now, now)
    if (agent === 'codex' && !externalId) pendingCodexIds.add(id)
    live.set(id, { terminalId: req.terminalId, owner })
    byTerminal.set(req.terminalId, id)
    try {
      await terminals.spawn({
        id: req.terminalId,
        owner,
        cwd,
        file: opts.bins[agent],
        args,
        env: { ...shellEnv(), WU_SESSION_ID: id, WU_AGENT_SOCKET: opts.socketPath },
        cols: req.cols,
        rows: req.rows,
      })
    } catch (error) {
      live.delete(id)
      byTerminal.delete(req.terminalId)
      pendingCodexIds.delete(id)
      // Aucun processus n'a démarré : une nouvelle session disparaît, une reprise retrouve son dernier état.
      if (before)
        db.prepare('UPDATE agent_sessions SET state = ?, updated_at = ? WHERE id = ?').run(
          before.state,
          before.updated_at,
          id,
        )
      else db.prepare('DELETE FROM agent_sessions WHERE id = ?').run(id)
      throw error
    }
    return toSession(row(id)!)
  }

  handle('agents:start', ({ cwd, agent, ...req }, event) =>
    launch({ id: randomUUID(), cwd, agent, external_id: null }, false, req, event.sender),
  )

  handle('agents:resume', ({ sessionId, terminalId, cols, rows }, event) => {
    const saved = row(sessionId)
    if (!saved) throw new Error(`Session ${sessionId} inconnue`)
    return launch(saved, true, { terminalId, cols, rows }, event.sender)
  })

  handle('agents:list', () =>
    (db.prepare('SELECT * FROM agent_sessions ORDER BY updated_at DESC LIMIT 200').all() as Row[]).map(
      toSession,
    ),
  )

  return {
    async writeReview(sessionId, cwd, owner, message) {
      const session = live.get(sessionId)
      const saved = row(sessionId)
      if (!session || session.owner !== owner || saved?.cwd !== cwd || saved.state !== 'done')
        throw new Error('Le message doit être envoyé à un agent disponible dans ce worktree.')
      // Codex signale la fin du tour. L'envoi depuis la revue donne aussi son point de départ.
      const codex = saved.agent === 'codex'
      if (codex) apply(sessionId, { type: 'prompt-submitted' })
      try {
        await terminals.writeConfirmed(session.terminalId, owner, message)
      } catch (error) {
        if (codex && live.get(sessionId) === session && row(sessionId)?.state === 'working')
          apply(sessionId, { type: 'turn-finished' })
        throw error
      }
    },
    sessionAgent: (id) => (pendingCodexIds.has(id) ? 'codex' : live.has(id) ? row(id)?.agent : undefined),
    onSocketEvent({ agent, sessionId, event, externalId }) {
      if (
        agent === 'codex' &&
        event.type === 'turn-finished' &&
        externalId &&
        pendingCodexIds.has(sessionId)
      ) {
        db.prepare('UPDATE agent_sessions SET external_id = ? WHERE id = ? AND external_id IS NULL').run(
          externalId,
          sessionId,
        )
        pendingCodexIds.delete(sessionId)
      }
      apply(sessionId, event)
    },
  }
}
