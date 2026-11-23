import { useEffect, useState } from 'react'
import { terminalStore } from '../terminals/terminal-store'
import { stateLabel, startAgent, type AgentInfo } from './agent-store'

const agentName = { 'claude-code': 'Claude Code', codex: 'Codex' } as const

function elapsed(since: number, now: number): string {
  const s = Math.max(0, Math.floor((now - since) / 1000))
  return s < 3600
    ? `${Math.floor(s / 60)} min ${s % 60} s`
    : `${Math.floor(s / 3600)} h ${Math.floor(s / 60) % 60} min`
}

// En-tête d'un onglet d'agent : qui, où, dans quel état, depuis quand, et les actions possibles.
export function AgentHeader({ terminalId, info, cwd }: { terminalId: string; info: AgentInfo; cwd: string }) {
  const [now, setNow] = useState(() => Date.now())
  const [error, setError] = useState('')
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const { icon, text } = stateLabel[info.state]

  return (
    <section className="agent-header" data-state={info.state} aria-label={`Agent ${agentName[info.agent]}`}>
      <span className="agent-state" role="status">
        <span aria-hidden="true">{icon}</span> {text}
      </span>
      <span>{agentName[info.agent]}</span>
      <span title={cwd}>{cwd.split('/').at(-1)}</span>
      <span>{elapsed(info.startedAt, now)}</span>
      {!info.exited && (
        // Échap interrompt le tour en cours (Claude Code et Codex), sans quitter la session.
        <button onClick={() => void window.wu.invoke('terminal:write', { id: terminalId, data: '\x1b' })}>
          Interrompre
        </button>
      )}
      {info.exited && (
        <button
          onClick={() =>
            void startAgent(cwd, info.title, { agent: info.agent, resumeOf: info.sessionId }).then(
              (id) => terminalStore.openAttachedTab(cwd, `${info.title} (reprise)`, id),
              (e: unknown) => setError(`Reprise impossible : ${String(e)}`),
            )
          }
        >
          Reprendre
        </button>
      )}
      <button onClick={() => terminalStore.closeActivePane()}>Fermer</button>
      {error && <span role="alert">{error}</span>}
    </section>
  )
}
