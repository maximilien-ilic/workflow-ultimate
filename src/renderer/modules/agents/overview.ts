type Entry = readonly [string, { state: string; startedAt: number }]

// DESIGN.md §1 : l'attention va à ce qui attend.
const priority: Record<string, number> = { waiting: 0, error: 1, working: 2, starting: 3, done: 4 }

export function sortForOverview<T extends Entry>(agents: readonly T[]): T[] {
  return [...agents].sort(
    ([, x], [, y]) => (priority[x.state] ?? 9) - (priority[y.state] ?? 9) || y.startedAt - x.startedAt,
  )
}

// Prochain agent en attente après `current`, dans l'ordre donné, en revenant au début.
export function nextWaiting(agents: readonly Entry[], current: string | null): string | null {
  const waiting = agents.filter(([, info]) => info.state === 'waiting').map(([id]) => id)
  if (waiting.length === 0) return null
  const index = agents.findIndex(([id]) => id === current)
  const after = agents.slice(index + 1).find(([id, info]) => info.state === 'waiting' && id !== current)
  return after?.[0] ?? waiting[0] ?? null
}
