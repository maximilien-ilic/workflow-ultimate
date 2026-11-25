import type { AgentSession, AgentState } from '../../../shared/ipc'
import { terminalStore } from '../terminals/terminal-store'

import notificationSoundUrl from '../shell/notification.wav'

window.wu.onAgentDesktopEvent((event) => {
  if (event.type === 'show-terminal') terminalStore.showPane(event.terminalId)
  else void new Audio(notificationSoundUrl).play().catch(() => {})
})

export type AgentInfo = {
  sessionId: string
  agent: AgentSession['agent']
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
// Fins de processus arrivées avant que l'agent soit connu (avant la réponse de agents:start) : appliquées
// au moment de started(). Bornées : seuls les tout derniers terminaux comptent.
const earlyExits = new Set<string>()

window.wu.onTerminalEvent((event) => {
  // pty-host perdu : tous les processus d'agents ont disparu, « Reprendre » doit être proposé partout.
  if (event.type === 'host-restarted') {
    for (const [terminalId, info] of agents) agents.set(terminalId, { ...info, exited: true })
    changed()
    return
  }
  if (event.type !== 'exit') return
  const info = agents.get(event.id)
  if (!info) {
    earlyExits.add(event.id)
    if (earlyExits.size > 100) earlyExits.delete(earlyExits.values().next().value!)
    return
  }
  agents.set(event.id, { ...info, exited: true })
  changed()
})

// Après un rechargement, les infos restaurées peuvent être périmées (l'agent a pu finir pendant le
// rechargement) : le main fait foi. Une session sans ce terminal vivant est terminée.
async function reconcile() {
  if (agents.size === 0) return
  // Chaque mise à jour remplace l'objet : une entrée identique à celle du départ n'a rien reçu de plus récent
  // pendant l'appel ; les autres gardent leur état, plus frais que la réponse.
  const before = new Map(agents)
  const sessions = await window.wu.invoke('agents:list', {}).catch(() => [])
  for (const [terminalId, info] of agents) {
    const session = sessions.find((s) => s.id === info.sessionId)
    if (!session || before.get(terminalId) !== info) continue
    agents.set(terminalId, { ...info, state: session.state, exited: session.terminalId !== terminalId })
  }
  changed()
}
void reconcile()

export const agentStore = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  version: () => version,
  get: (terminalId: string) => agents.get(terminalId),
  all: () => [...agents],
  stateOf: (terminalId: string) => agents.get(terminalId)?.state,
  started(terminalId: string, info: Omit<AgentInfo, 'startedAt' | 'state' | 'exited'>, state: AgentState) {
    // Un événement a pu arriver avant la réponse de agents:start : il est plus récent, on le garde.
    const current = agents.get(terminalId)
    const exited = earlyExits.delete(terminalId)
    agents.set(terminalId, { ...info, startedAt: Date.now(), state: current?.state ?? state, exited })
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
export async function startAgent(
  cwd: string,
  title: string,
  opts: { agent?: AgentSession['agent']; resumeOf?: string; prompt?: string } = {},
): Promise<string> {
  const { agent = 'claude-code', resumeOf } = opts
  const terminalId = crypto.randomUUID()
  const size = { cols: 120, rows: 30 }
  const session = resumeOf
    ? await window.wu.invoke('agents:resume', { sessionId: resumeOf, terminalId, ...size })
    : await window.wu.invoke('agents:start', { terminalId, cwd, agent, prompt: opts.prompt, ...size })
  agentStore.started(terminalId, { sessionId: session.id, agent: session.agent, title }, session.state)
  return terminalId
}
