import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { WebContents } from 'electron'
import {
  maxAgentPromptLength,
  type AgentState,
  type IpcRequest,
  type Task,
  type TaskAgentStarted,
} from '../../../shared/ipc'
import type { AgentSessions } from '../agents/sessions'
import { projectWorkspaces } from '../projects/ipc'
import { checkedProjectPath, repoInfo } from '../projects/registry'
import { branchExists, branchForLocalTask, createWorktree, defaultBranchRef, issueBranch, listWorktrees } from '../projects/worktrees'
import { taskColumns } from './tasks'

type DispatchRequest = IpcRequest<'tasks:dispatch'>
type DispatchTask = Task & { branch: string | null; sessionId: string | null; sessionState: AgentState | null }
const terminalSize = { cols: 120, rows: 30 }
const taskInstructions = 'Lis AGENTS.md avant de commencer.\nSpécification : [docs/SPEC.md](docs/SPEC.md)'

export function readDispatchTask(
  db: DatabaseSync, { projectId, id }: DispatchRequest, isOpen: AgentSessions['isOpen'],
): DispatchTask {
  const task = db
    .prepare(
      `
    SELECT ${taskColumns}, agent_branch AS branch, agent_session_id AS sessionId,
           (SELECT state FROM agent_sessions WHERE id = tasks.agent_session_id) AS sessionState
    FROM tasks WHERE project_id = ? AND id = ?
  `,
    )
    .get(projectId, id) as DispatchTask | undefined
  if (!task) throw new Error(`Tâche inconnue (${id})`)
  const canReplace = !task.sessionId || (task.sessionState === 'error' && !isOpen(task.sessionId))
  if (task.status !== 'todo' || !canReplace) throw new Error('Cette tâche a déjà été prise en charge.')
  return task
}

function buildPrompt(task: Task): string {
  const title = `# ${task.title}\n\n`
  const details = [task.issueUrl, task.body].filter(Boolean).join('\n\n')
  return (
    title +
    details.slice(0, maxAgentPromptLength - title.length - taskInstructions.length - 2) +
    '\n\n' +
    taskInstructions
  )
}

async function taskBranch(repo: string, task: DispatchTask): Promise<string> {
  if (task.branch) return task.branch
  if (!task.issueNumber) return branchForLocalTask(task.id, task.title)
  const issue = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)$/.exec(task.issueUrl ?? '')
  if (!issue || Number(issue[2]) !== task.issueNumber) throw new Error('Lien de l’issue GitHub invalide.')
  return issueBranch(repo, task.issueNumber, issue[1])
}

async function worktreeForBranch(repo: string, branch: string): Promise<string> {
  const existing = (await listWorktrees(repo)).find((worktree) => worktree.branch === branch)
  if (!existing) {
    const workspaces = projectWorkspaces()
    if (await branchExists(repo, branch)) return createWorktree(repo, workspaces, { branch, create: false })
    const base = await defaultBranchRef(repo)
    return createWorktree(repo, workspaces, { branch, base, create: true })
  }
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

function showTaskAgent(owner: WebContents, event: TaskAgentStarted): void {
  if (owner.isDestroyed()) return
  const send = () => owner.send('tasks:agentStarted', event)
  if (owner.isLoadingMainFrame()) owner.once('did-finish-load', send)
  else send()
}

function linkSession(db: DatabaseSync, { id, projectId }: DispatchRequest, sessionId: string): boolean {
  return Boolean(
    db
      .prepare(
        `
    UPDATE tasks SET agent_session_id = ?, status = CASE WHEN status = 'todo' THEN 'doing' ELSE status END
    WHERE id = ? AND project_id = ? AND agent_session_id IS NULL
  `,
      )
      .run(sessionId, id, projectId).changes,
  )
}

export function createTaskDispatch(db: DatabaseSync, agents: Pick<AgentSessions, 'start' | 'isOpen'>) {
  return async (request: DispatchRequest, owner: WebContents, hasSlot: () => boolean): Promise<boolean> => {
    const task = readDispatchTask(db, request, agents.isOpen)
    const repo = await checkedProjectPath(db, request.projectId)
    const branch = await taskBranch(repo, task)
    reserveBranch(db, request, branch)
    const cwd = await worktreeForBranch(repo, branch)
    if (!hasSlot()) return false
    if (owner.isDestroyed()) throw new Error('La fenêtre qui a demandé l’envoi est fermée.')
    // La préparation du worktree a pu laisser le temps de reprendre l’ancienne session.
    const current = readDispatchTask(db, request, agents.isOpen)
    const previous = current.sessionId
    const setSession = db.prepare(
      'UPDATE tasks SET agent_session_id = ? WHERE id = ? AND project_id = ? AND agent_session_id IS ?',
    )
    if (previous && !setSession.run(null, request.id, request.projectId, previous).changes)
      throw new Error('La session de la tâche a changé pendant la préparation.')
    const terminalId = randomUUID()
    const session = await agents.start(
      { cwd, agent: request.agent, terminalId, prompt: buildPrompt(current), ...terminalSize },
      owner,
    ).catch((error: unknown) => {
      if (previous) setSession.run(previous, request.id, request.projectId, null)
      throw error
    })
    const linked = linkSession(db, request, session.id)
    showTaskAgent(owner, { session, terminalId, branch })
    if (!linked) throw new Error('La tâche a été supprimée pendant le lancement.')
    return true
  }
}
