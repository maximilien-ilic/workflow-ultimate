export type AgentState = 'starting' | 'working' | 'waiting' | 'done' | 'error'

type HookEventType = 'prompt-submitted' | 'needs-input' | 'turn-finished' | 'error'
export type AgentEvent = { type: HookEventType } | { type: 'pty-exit'; code: number | null }

const transitions: Record<AgentState, Partial<Record<HookEventType, AgentState>>> = {
  starting: {
    'prompt-submitted': 'working',
    'needs-input': 'waiting',
    'turn-finished': 'done',
    error: 'error',
  },
  working: { 'needs-input': 'waiting', 'turn-finished': 'done', error: 'error' },
  waiting: { 'prompt-submitted': 'working', 'turn-finished': 'done', error: 'error' },
  done: { 'prompt-submitted': 'working', error: 'error' },
  error: {},
}

export function transitionAgent(
  state: AgentState,
  event: AgentEvent,
): { state: AgentState; ignoredReason: string | null } {
  // Une fermeture ultérieure du PTY ne doit pas effacer une erreur déjà signalée par un hook.
  if (event.type === 'pty-exit' && state !== 'error') {
    return { state: event.code === 0 ? 'done' : 'error', ignoredReason: null }
  }

  const next = event.type === 'pty-exit' ? undefined : transitions[state][event.type]
  return next
    ? { state: next, ignoredReason: null }
    : { state, ignoredReason: `Événement « ${event.type} » ignoré dans l’état « ${state} »` }
}
