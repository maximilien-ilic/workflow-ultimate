import type { WebContents } from 'electron'
import type { TaskQueue, TasksChanged } from '../../../shared/ipc'
import { DEFAULT_AGENT_CONCURRENCY } from '../../../shared/settings'
import type { AgentSessions } from '../agents/sessions'
import { handle } from '../shell/ipc'
import { readAgentConcurrency, saveAgentConcurrency } from '../shell/settings'
import { createTaskQueue } from './queue'

type Capacity = Pick<AgentSessions, 'activeCount' | 'onSlotAvailable'>

function loadLimit(): number {
  try {
    return readAgentConcurrency()
  } catch (error) {
    console.warn('Impossible de lire la limite des agents :', error)
    return DEFAULT_AGENT_CONCURRENCY
  }
}

export function registerTaskQueue(agents: Capacity) {
  const observers = new Set<WebContents>()
  let limit = loadLimit()
  const snapshot = (): TaskQueue => ({ limit, pending: queue.list() })

  function notify(projectId?: string, error?: string): void {
    const message: TasksChanged = { projectId, error, queue: snapshot() }
    for (const owner of observers) if (!owner.isDestroyed()) owner.send('tasks:changed', message)
  }

  const queue = createTaskQueue(() => agents.activeCount() < limit, notify)
  agents.onSlotAvailable(() => void queue.drain())

  handle('tasks:queue', (_request, { sender }) => {
    if (!observers.has(sender)) {
      observers.add(sender)
      sender.once('destroyed', () => observers.delete(sender))
    }
    return snapshot()
  })
  handle('tasks:reorderQueue', ({ id, direction }) => {
    queue.move(id, direction)
    return snapshot()
  })
  handle('settings:setAgentConcurrency', ({ max }) => {
    saveAgentConcurrency(max)
    limit = max
    notify()
    void queue.drain()
    return snapshot()
  })

  return { ...queue, notify }
}
