// Contrôle de flux par terminal : si le renderer n'accuse pas réception assez vite,
// on met le PTY en pause plutôt que d'accumuler la sortie en mémoire (même principe que VS Code).
export class FlowControl {
  private readonly pending = new Map<string, { unacked: number; paused: boolean }>()

  constructor(
    private readonly high = 100_000,
    private readonly low = 10_000,
  ) {}

  onData(id: string, chars: number): 'pause' | null {
    const state = this.state(id)
    state.unacked += chars
    if (state.paused || state.unacked <= this.high) return null
    state.paused = true
    return 'pause'
  }

  onAck(id: string, chars: number): 'resume' | null {
    const state = this.state(id)
    state.unacked = Math.max(0, state.unacked - chars)
    if (!state.paused || state.unacked >= this.low) return null
    state.paused = false
    return 'resume'
  }

  forget(id: string): void {
    this.pending.delete(id)
  }

  clear(): void {
    this.pending.clear()
  }

  private state(id: string) {
    let state = this.pending.get(id)
    if (!state) this.pending.set(id, (state = { unacked: 0, paused: false }))
    return state
  }
}
