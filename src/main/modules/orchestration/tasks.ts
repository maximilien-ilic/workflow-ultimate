import type { DatabaseSync, StatementResultingChanges } from 'node:sqlite'
import type { Task, TaskStatus } from '../../../shared/ipc'

type TaskDraft = Pick<Task, 'title' | 'body'>
export type IssueTask = Omit<Task, 'id' | 'issueNumber' | 'issueUrl'> & { issueNumber: number; issueUrl: string }

export const taskColumns = 'id, title, body, status, issue_number AS issueNumber, issue_url AS issueUrl'

// Le renderer désigne une tâche par son id : on refuse celle d'un autre projet comme une inconnue.
function expectOneTask({ changes }: StatementResultingChanges, id: number): void {
  if (changes === 0) throw new Error(`Tâche inconnue (${id})`)
}

export function createTasks(db: DatabaseSync) {
  const select = db.prepare(`SELECT ${taskColumns} FROM tasks WHERE project_id = ? ORDER BY id`)
  const insert = db.prepare(
    `INSERT INTO tasks (project_id, title, body, status) VALUES (?, ?, ?, 'todo') RETURNING ${taskColumns}`,
  )
  const edit = db.prepare('UPDATE tasks SET title = ?, body = ? WHERE id = ? AND project_id = ?')
  const setStatus = db.prepare('UPDATE tasks SET status = ? WHERE id = ? AND project_id = ?')
  // Une issue fermée termine la tâche ; sinon la réimportation garde la colonne choisie dans l'appli.
  // Un champ ne suit GitHub que s'il correspond encore à la dernière version reçue.
  // Les lignes sans référence (créées avant la migration) gardent leur texte au premier import.
  const upsertIssue = db.prepare(`
    INSERT INTO tasks (project_id, title, body, status, issue_number, issue_url, github_title, github_body)
    VALUES ($projectId, $title, $body, $status, $issueNumber, $issueUrl, $title, $body)
    ON CONFLICT (project_id, issue_number) DO UPDATE SET
      title = CASE WHEN tasks.title = tasks.github_title THEN excluded.title ELSE tasks.title END,
      body = CASE WHEN tasks.body = tasks.github_body THEN excluded.body ELSE tasks.body END,
      github_title = excluded.github_title,
      github_body = excluded.github_body,
      issue_url = excluded.issue_url,
      status = CASE WHEN excluded.status = 'done' THEN 'done' ELSE tasks.status END
  `)
  return {
    list: (projectId: string) => select.all(projectId) as Task[],
    create: (projectId: string, { title, body }: TaskDraft) => insert.get(projectId, title, body) as Task,
    update(projectId: string, id: number, { title, body }: TaskDraft) {
      expectOneTask(edit.run(title, body, id, projectId), id)
    },
    move(projectId: string, id: number, status: TaskStatus) {
      expectOneTask(setStatus.run(status, id, projectId), id)
    },
    saveIssue(projectId: string, { title, body, status, issueNumber, issueUrl }: IssueTask) {
      upsertIssue.run({ projectId, title, body, status, issueNumber, issueUrl })
    },
  }
}
