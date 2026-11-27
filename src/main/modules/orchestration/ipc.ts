import type { DatabaseSync } from 'node:sqlite'
import type { AgentSessions } from '../agents/sessions'
import { getProject } from '../projects/registry'
import { handle } from '../shell/ipc'
import { syncIssues } from './github-sync'
import { registerTaskQueue } from './queue-ipc'
import { createTaskDispatch, readDispatchTask } from './task-dispatch'
import { createTasks } from './tasks'

export function registerTaskHandlers(db: DatabaseSync, agents: Pick<AgentSessions, 'start' | 'activeCount' | 'onSlotAvailable'>): void {
  const tasks = createTasks(db)
  const dispatch = createTaskDispatch(db, agents)
  const queue = registerTaskQueue(agents)
  // Chaque canal vérifie le projet puis renvoie tout son tableau : le renderer n'a qu'un état à remplacer.
  const listOf = (projectId: string) => {
    getProject(db, projectId)
    return tasks.list(projectId)
  }
  handle('tasks:list', ({ projectId }) => listOf(projectId))
  handle('tasks:create', ({ projectId, title, body }) => {
    getProject(db, projectId)
    tasks.create(projectId, { title, body })
    return listOf(projectId)
  })
  handle('tasks:update', ({ projectId, id, title, body }) => {
    tasks.update(projectId, id, { title, body })
    return listOf(projectId)
  })
  handle('tasks:dispatch', (request, { sender }) => {
    const { id, projectId, agent } = request
    const { title } = readDispatchTask(db, request)
    queue.enqueue({ id, projectId, title, agent }, (hasSlot) => dispatch(request, sender, hasSlot))
    void queue.drain()
    return listOf(projectId)
  })
  handle('tasks:move', ({ projectId, id, status }) => {
    if (queue.has(id)) throw new Error('Cette tâche est en file d’attente ou en cours d’envoi.')
    tasks.move(projectId, id, status)
    return listOf(projectId)
  })
  handle('tasks:importIssues', async ({ projectId }) => {
    await syncIssues(db, projectId)
    return tasks.list(projectId)
  })
}
