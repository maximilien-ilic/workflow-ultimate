import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { registerCommand } from '../palette/commands'
import { terminalStore } from '../terminals/terminal-store'
import { lastLines } from '../terminals/TerminalView'
import { agentStore, stateLabel } from './agent-store'
import { nextWaiting, sortForOverview } from './overview'

// Vue d'ensemble (Ctrl+Shift+A) : tous les agents, ceux qui attendent en premier, avec un aperçu.
// Ctrl+Shift+J va au prochain agent en attente (pas Ctrl+J : c'est un caractère utile dans un shell).
export function AgentOverview() {
  const dialog = useRef<HTMLDialogElement>(null)
  useSyncExternalStore(agentStore.subscribe, agentStore.version)
  const [, tick] = useState(0)

  useEffect(() => {
    const removeOverview = registerCommand({
      id: 'agents.overview',
      title: 'Vue d’ensemble des agents',
      keybinding: 'Ctrl+Shift+A',
      run: () => dialog.current?.showModal(),
    })
    const removeNext = registerCommand({
      id: 'agents.next-waiting',
      title: 'Agent suivant en attente',
      keybinding: 'Ctrl+Shift+J',
      run() {
        const next = nextWaiting(sortForOverview(agentStore.all()), terminalStore.activePane())
        if (next) terminalStore.showPane(next)
      },
    })
    // L'aperçu des terminaux change sans événement React : on le relit chaque seconde.
    const timer = setInterval(() => dialog.current?.open && tick((n) => n + 1), 1000)
    return () => {
      removeOverview()
      removeNext()
      clearInterval(timer)
    }
  }, [])

  const agents = sortForOverview(agentStore.all())
  return (
    <dialog ref={dialog} className="agent-overview" aria-label="Vue d’ensemble des agents">
      <h2>Agents</h2>
      {agents.length === 0 && <p>Aucun agent lancé.</p>}
      <ul>
        {agents.map(([terminalId, info]) => {
          const { icon, text } = stateLabel[info.state]
          return (
            <li key={terminalId}>
              <button
                aria-label={`${info.title} : ${text}`}
                onClick={() => {
                  dialog.current?.close()
                  terminalStore.showPane(terminalId)
                }}
              >
                <span aria-hidden="true">{icon}</span> {info.title} — {text}
              </button>
              <pre aria-hidden="true">{lastLines(terminalId, 5).join('\n')}</pre>
            </li>
          )
        })}
      </ul>
      <button onClick={() => dialog.current?.close()}>Fermer</button>
    </dialog>
  )
}
