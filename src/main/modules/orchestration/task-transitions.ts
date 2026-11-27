import type { DatabaseSync } from 'node:sqlite'
import { checkedProjectPath } from '../projects/registry'
import { readBranchPullRequest } from '../review/pull-request'

export const TASK_PR_POLL_INTERVAL_MS = 30_000

type Candidate = {
  id: number
  projectId: string
  sessionId: string
  branch: string
  startedAt: number
  status: 'doing' | 'review'
}

function candidates(db: DatabaseSync): Candidate[] {
  return db
    .prepare(
      `
    SELECT tasks.id, project_id AS projectId, agent_session_id AS sessionId, agent_branch AS branch,
           agent_sessions.created_at AS startedAt, tasks.status
    FROM tasks JOIN agent_sessions ON agent_sessions.id = tasks.agent_session_id
    WHERE tasks.status IN ('doing', 'review') AND agent_branch IS NOT NULL AND agent_sessions.state = 'done'
  `,
    )
    .all() as Candidate[]
}

function moveTask(db: DatabaseSync, task: Candidate, status: 'review' | 'done'): boolean {
  return Boolean(
    db
      .prepare(
        `
    UPDATE tasks SET status = ?
    WHERE id = ? AND project_id = ? AND status = ? AND agent_session_id = ? AND agent_branch = ?
      AND EXISTS (SELECT 1 FROM agent_sessions WHERE id = tasks.agent_session_id AND state = 'done')
  `,
      )
      .run(status, task.id, task.projectId, task.status, task.sessionId, task.branch).changes,
  )
}

export function createTaskTransitions(db: DatabaseSync, notify: (projectId: string) => void) {
  let closed = false
  let requested = false
  let running: Promise<void> | undefined

  async function verify(task: Candidate): Promise<void> {
    const repo = await checkedProjectPath(db, task.projectId)
    if (closed) return
    const pr = await readBranchPullRequest(repo, task.branch, task.startedAt)
    if (closed || !pr) return
    const next = pr === 'MERGED' ? 'done' : 'review'
    // La tâche peut être déplacée ou la session reprise pendant la lecture réseau.
    if (task.status !== next && moveTask(db, task, next)) notify(task.projectId)
  }

  async function reconcile(): Promise<void> {
    while (requested && !closed) {
      requested = false
      for (const task of candidates(db)) {
        if (closed) return
        try {
          await verify(task)
        } catch (error) {
          // Le prochain passage retentera les lectures échouées sans écraser l'état local.
          if (!closed) console.warn(`État PR de la tâche ${task.id} indisponible : ${String(error)}`)
        }
      }
    }
  }

  function refresh(): Promise<void> {
    if (closed) return Promise.resolve()
    requested = true
    return (running ??= Promise.resolve()
      .then(reconcile)
      .finally(() => {
        running = undefined
        if (requested && !closed) return refresh()
      }))
  }

  return {
    refresh,
    close: () => {
      closed = true
    },
  }
}
