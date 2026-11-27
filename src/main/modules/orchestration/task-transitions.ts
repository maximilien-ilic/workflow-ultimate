import type { DatabaseSync } from 'node:sqlite'
import { checkedProjectPath } from '../projects/registry'
import { readBranchPullRequest, resolveBranchPullRequestRepository } from '../review/pull-request'

export const TASK_PR_POLL_INTERVAL_MS = 30_000
const MAX_CONCURRENT_PROJECTS = 4

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

  async function verifyProject([projectId, tasks]: [string, Candidate[]]): Promise<void> {
    let repo: string
    let repository: string | undefined
    try {
      repo = await checkedProjectPath(db, projectId)
      if (closed) return
      repository = await resolveBranchPullRequestRepository(repo)
    } catch (error) {
      if (!closed) console.warn(`Dépôt du projet ${projectId} indisponible : ${String(error)}`)
      return
    }
    if (!repository) return

    for (const task of tasks) {
      if (closed) return
      try {
        const pr = await readBranchPullRequest(repo, task.branch, task.startedAt, repository)
        if (closed || !pr) continue
        const next = pr === 'MERGED' ? 'done' : 'review'
        // La tâche peut avoir été déplacée ou la session reprise pendant la lecture réseau.
        if (task.status !== next && moveTask(db, task, next)) notify(projectId)
      } catch (error) {
        if (!closed) console.warn(`État PR de la tâche ${task.id} indisponible : ${String(error)}`)
      }
    }
  }

  async function reconcile(): Promise<void> {
    while (requested && !closed) {
      requested = false
      const projects = new Map<string, Candidate[]>()
      for (const task of candidates(db)) {
        const group = projects.get(task.projectId)
        if (group) group.push(task)
        else projects.set(task.projectId, [task])
      }
      const pending = projects.entries()
      const scan = async () => {
        for (const project of pending) {
          if (closed) break
          await verifyProject(project)
        }
      }
      await Promise.all(Array.from({ length: Math.min(projects.size, MAX_CONCURRENT_PROJECTS) }, scan))
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
