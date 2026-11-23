type Waiter<T> = { resolve: (value: T) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }

// Requêtes au pty-host dont la réponse arrive par un événement (rejeu, confirmation de lancement) :
// chaque attente finit toujours, par une réponse, une erreur ou un délai dépassé.
export class Pending<T> {
  private readonly waiters = new Map<string, Waiter<T>[]>()

  wait(id: string, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => this.fail(id, new Error(`Pas de réponse du pty-host (délai dépassé)`)),
        timeoutMs,
      )
      this.waiters.set(id, [...(this.waiters.get(id) ?? []), { resolve, reject, timer }])
    })
  }

  settle(id: string, value: T): void {
    for (const w of this.take(id)) w.resolve(value)
  }

  fail(id: string, error: Error): void {
    for (const w of this.take(id)) w.reject(error)
  }

  failAll(error: Error): void {
    for (const id of [...this.waiters.keys()]) this.fail(id, error)
  }

  private take(id: string): Waiter<T>[] {
    const list = this.waiters.get(id) ?? []
    this.waiters.delete(id)
    list.forEach((w) => clearTimeout(w.timer))
    return list
  }
}
