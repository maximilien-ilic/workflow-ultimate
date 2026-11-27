import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { WebContents } from 'electron'
import {
  AGENT_PROMPT_MAX_LENGTH,
  type IpcRequest,
  type Task,
  type TaskAgentStarted,
} from '../../../shared/ipc'
import type { AgentSessions } from '../agents/sessions'
import { projectWorkspaces } from '../projects/ipc'
import { checkedProjectPath, repoInfo } from '../projects/registry'
import { branchForIssue, createWorktree, issueBranch, listWorktrees } from '../projects/worktrees'
import { taskColumns } from './tasks'

type DispatchRequest = IpcRequest<'tasks:dispatch'>
type DispatchTask = Task & { branch: string | null; sessionId: string | null }
const terminalSize = { cols: 120, rows: 30 }
const taskInstructions = 'Lis AGENTS.md avant de commencer.\nSpécification : [docs/SPEC.md](docs/SPEC.md)'

function readTask(db: DatabaseSync, { projectId, id }: DispatchRequest): DispatchTask {
  const task = db
    .prepare(
      `
    SELECT ${taskColumns}, agent_branch AS branch, agent_session_id AS sessionId
    FROM tasks WHERE project_id = ? AND id = ?
  `,
    )
    .get(projectId, id) as DispatchTask | undefined
  if (!task) throw new Error(`Tâche inconnue (${id})`)
  if (task.status !== 'todo' || task.sessionId) throw new Error('Cette tâche a déjà été prise en charge.')
  return task
}

function buildPrompt(task: Task): string {
  const title = `# ${task.title}\n\n`
  const details = [task.issueUrl, task.body].filter(Boolean).join('\n\n')
  return (
    title +
    details.slice(0, AGENT_PROMPT_MAX_LENGTH - title.length - taskInstructions.length - 2) +
    '\n\n' +
    taskInstructions
  )
}

async function taskBranch(repo: string, task: DispatchTask): Promise<string> {
  if (task.branch) return task.branch
  if (!task.issueNumber) return branchForIssue(task.id, task.title)
  const issue = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)$/.exec(task.issueUrl ?? '')
  if (!issue || Number(issue[2]) !== task.issueNumber) throw new Error('Lien de l’issue GitHub invalide.')
  return issueBranch(repo, task.issueNumber, issue[1])
}

async function worktreeForBranch(repo: string, branch: string): Promise<string> {
  const existing = (await listWorktrees(repo)).find((worktree) => worktree.branch === branch)
  if (!existing) return createWorktree(repo, projectWorkspaces(), { branch })
  const [project, target] = await Promise.all([repoInfo(repo), repoInfo(existing.path)])
  if (existing.main || target.gitDir !== project.gitDir)
    throw new Error('Ce worktree ne peut pas recevoir la tâche.')
  return existing.path
}

function reserveBranch(db: DatabaseSync, { projectId, id }: DispatchRequest, branch: string): void {
  const result = db
    .prepare(
      `
    UPDATE tasks SET agent_branch = ? WHERE id = ? AND project_id = ? AND status = 'todo'
      AND NOT EXISTS (SELECT 1 FROM tasks WHERE project_id = ? AND agent_branch = ? AND id != ?)
  `,
    )
    .run(branch, id, projectId, projectId, branch, id)
  if (!result.changes) throw new Error('La tâche a changé ou cette branche est réservée à une autre tâche.')
}

export function createTaskDispatch(db: DatabaseSync, agents: Pick<AgentSessions, 'start'>) {
  const starting = new Set<number>()

  async function dispatch(request: DispatchRequest, owner: WebContents): Promise<void> {
    if (starting.has(request.id)) throw new Error('Cette tâche est déjà en cours d’envoi.')
    const task = readTask(db, request)
    starting.add(task.id)
    try {
      const repo = await checkedProjectPath(db, request.projectId)
      const branch = await taskBranch(repo, task)
      reserveBranch(db, request, branch)
      const cwd = await worktreeForBranch(repo, branch)
      if (owner.isDestroyed()) throw new Error('La fenêtre qui a demandé l’envoi est fermée.')
      const terminalId = randomUUID()
      const session = await agents.start(
        { cwd, agent: request.agent, terminalId, prompt: buildPrompt(task), ...terminalSize },
        owner,
      )
      const linked = db
        .prepare(
          `
        UPDATE tasks SET agent_session_id = ?, status = CASE WHEN status = 'todo' THEN 'doing' ELSE status END
        WHERE id = ? AND project_id = ?
      `,
        )
        .run(session.id, task.id, request.projectId)
      if (!owner.isDestroyed())
        owner.send('tasks:agentStarted', { session, terminalId, branch } satisfies TaskAgentStarted)
      if (!linked.changes) throw new Error('La tâche a été supprimée pendant le lancement.')
    } finally {
      starting.delete(task.id)
    }
  }

  return { dispatch, isStarting: (id: number) => starting.has(id) }
}
