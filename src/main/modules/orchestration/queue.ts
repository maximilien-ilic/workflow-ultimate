import type { TaskQueueItem } from '../../../shared/ipc'

type Entry = { task: TaskQueueItem; launch: (hasSlot: () => boolean) => Promise<boolean> }
type Notify = (projectId?: string, error?: string) => void

export function createTaskQueue(hasSlot: () => boolean, notify: Notify) {
  // shortcut: la file vit dans le processus principal ; la persister si elle doit survivre à un redémarrage.
  const pending: Entry[] = []
  const failures = new Map<number, { projectId: string; message: string }>()
  let starting: Entry | undefined
  let draining: Promise<void> | undefined

  function has(id: number): boolean {
    return starting?.task.id === id || pending.some(({ task }) => task.id === id)
  }

  function enqueue(task: TaskQueueItem, launch: Entry['launch']): void {
    if (has(task.id)) throw new Error('Cette tâche est déjà en file d’attente ou en cours d’envoi.')
    pending.push({ task, launch })
    notify()
  }

  function move(id: number, direction: -1 | 1): void {
    const index = pending.findIndex(({ task }) => task.id === id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= pending.length) return
    const [entry] = pending.splice(index, 1)
    pending.splice(target, 0, entry!)
    notify()
  }

  async function launchNext(): Promise<boolean> {
    const entry = pending.shift()!
    starting = entry
    notify()
    const { id, projectId, title } = entry.task
    try {
      if (await entry.launch(hasSlot)) {
        failures.delete(id)
        notify(projectId)
        return true
      }
      pending.unshift(entry)
      notify()
      return false
    } catch (error) {
      const message = `${title} : ${(error as Error).message}`
      failures.set(id, { projectId, message })
      notify(projectId, message)
      return true
    } finally {
      starting = undefined
    }
  }

  async function drainUntilFull() {
    while (pending.length && hasSlot()) if (!(await launchNext())) break
  }

  return {
    has,
    enqueue,
    move,
    list: () => pending.map(({ task }) => task),
    failures: (projectId: string) => [...failures].flatMap(([id, failure]) =>
      failure.projectId === projectId ? [{ id, message: failure.message }] : [],
    ),
    drain: () =>
      (draining ??= drainUntilFull().finally(() => {
        draining = undefined
      })),
  }
}
