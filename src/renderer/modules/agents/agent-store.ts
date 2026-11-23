import type { AgentState } from '../../../shared/ipc'

// État des agents par terminal, mis à jour par les événements `agent:event` du main.
const states = new Map<string, AgentState>()
const listeners = new Set<() => void>()
let version = 0

window.wu.onAgentEvent(({ terminalId, state }) => {
  states.set(terminalId, state)
  version++
  listeners.forEach((l) => l())
})

export const agentStore = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  version: () => version,
  stateOf: (terminalId: string) => states.get(terminalId),
  // Un agent qui vient d'être lancé démarre en « starting » avant tout événement.
  started(terminalId: string) {
    if (states.has(terminalId)) return // un événement est déjà arrivé : il est plus récent
    states.set(terminalId, 'starting')
    version++
    listeners.forEach((l) => l())
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
