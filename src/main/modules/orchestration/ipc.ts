import type { DatabaseSync } from 'node:sqlite'
import { getProject } from '../projects/registry'
import { handle } from '../shell/ipc'
import { syncIssues } from './github-sync'
import { createTasks } from './tasks'

export function registerTaskHandlers(db: DatabaseSync): void {
  const tasks = createTasks(db)
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
  handle('tasks:move', ({ projectId, id, status }) => {
    tasks.move(projectId, id, status)
    return listOf(projectId)
  })
  handle('tasks:importIssues', async ({ projectId }) => {
    await syncIssues(db, projectId)
    return tasks.list(projectId)
  })
}
