import type { AgentState } from '../../../shared/ipc'

export type AgentInfo = {
  sessionId: string
  agent: 'claude-code'
  title: string
  startedAt: number
  state: AgentState
  exited: boolean // le processus de l'agent est terminé : seul « Reprendre » a encore un sens
}

// Agents par terminal. sessionStorage : survit à un rechargement du renderer, comme les onglets.
const KEY = 'wu.agents'
const agents = new Map<string, AgentInfo>(load())
const listeners = new Set<() => void>()
let version = 0

function load(): [string, AgentInfo][] {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? '[]') as [string, AgentInfo][]
  } catch {
    return []
  }
}

function changed() {
  version++
  try {
    sessionStorage.setItem(KEY, JSON.stringify([...agents]))
  } catch {
    // sans stockage, l'en-tête d'agent disparaît seulement après un rechargement
  }
  listeners.forEach((l) => l())
}

window.wu.onAgentEvent(({ terminalId, state }) => {
  const info = agents.get(terminalId)
  if (!info) return
  agents.set(terminalId, { ...info, state })
  changed()
})
window.wu.onTerminalEvent((event) => {
  const info = event.type === 'exit' ? agents.get(event.id) : undefined
  if (!info || event.type !== 'exit') return
  agents.set(event.id, { ...info, exited: true })
  changed()
})

export const agentStore = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  version: () => version,
  get: (terminalId: string) => agents.get(terminalId),
  stateOf: (terminalId: string) => agents.get(terminalId)?.state,
  started(terminalId: string, info: Omit<AgentInfo, 'startedAt' | 'state' | 'exited'>, state: AgentState) {
    // Un événement a pu arriver avant la réponse de agents:start : il est plus récent, on le garde.
    const current = agents.get(terminalId)
    agents.set(terminalId, { ...info, startedAt: Date.now(), state: current?.state ?? state, exited: false })
    changed()
  },
}

// DESIGN.md §3 : une icône et un libellé pour chaque état (la couleur seule ne suffit pas).
export const stateLabel: Record<AgentState, { icon: string; text: string }> = {
  starting: { icon: '○', text: 'démarrage' },
  working: { icon: '●', text: 'travaille' },
  waiting: { icon: '◐', text: 'attend une réponse' },
  done: { icon: '✓', text: 'terminé' },
  error: { icon: '✕', text: 'erreur' },
}

// Lance un agent dans un nouveau terminal ; renvoie l'id du terminal à ouvrir dans un onglet.
export async function startAgent(cwd: string, title: string, resumeOf?: string): Promise<string> {
  const terminalId = crypto.randomUUID()
  const size = { cols: 120, rows: 30 }
  const session = resumeOf
    ? await window.wu.invoke('agents:resume', { sessionId: resumeOf, terminalId, ...size })
    : await window.wu.invoke('agents:start', { terminalId, cwd, agent: 'claude-code', ...size })
  agentStore.started(terminalId, { sessionId: session.id, agent: session.agent, title }, session.state)
  return terminalId
}
