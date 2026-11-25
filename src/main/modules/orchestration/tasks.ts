import type { DatabaseSync, StatementResultingChanges } from 'node:sqlite'
import type { Task, TaskStatus } from '../../../shared/ipc'

type TaskDraft = Pick<Task, 'title' | 'body'>

// Le renderer désigne une tâche par son id : on refuse celle d'un autre projet comme une inconnue.
function expectOneTask({ changes }: StatementResultingChanges, id: number): void {
  if (changes === 0) throw new Error(`Tâche inconnue (${id})`)
}

export function createTasks(db: DatabaseSync) {
  const select = db.prepare('SELECT id, title, body, status FROM tasks WHERE project_id = ? ORDER BY id')
  const insert = db.prepare(
    "INSERT INTO tasks (project_id, title, body, status) VALUES (?, ?, ?, 'todo') RETURNING id, title, body, status",
  )
  const edit = db.prepare('UPDATE tasks SET title = ?, body = ? WHERE id = ? AND project_id = ?')
  const setStatus = db.prepare('UPDATE tasks SET status = ? WHERE id = ? AND project_id = ?')
  return {
    list: (projectId: string) => select.all(projectId) as Task[],
    create: (projectId: string, { title, body }: TaskDraft) => insert.get(projectId, title, body) as Task,
    update(projectId: string, id: number, { title, body }: TaskDraft) {
      expectOneTask(edit.run(title, body, id, projectId), id)
    },
    move(projectId: string, id: number, status: TaskStatus) {
      expectOneTask(setStatus.run(status, id, projectId), id)
    },
  }
}
