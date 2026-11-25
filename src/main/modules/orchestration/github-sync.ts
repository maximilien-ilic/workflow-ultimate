import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { TASK_BODY_MAX_LENGTH } from '../../../shared/ipc'
import { checkedProjectPath } from '../projects/registry'
import { gh } from '../review/pull-request'
import { createTasks, type IssueTask } from './tasks'

const ISSUE_FIELDS = 'number,title,body,state,url'
// shortcut: au-delà de 1000 issues, les plus anciennes sont ignorées ; paginer avec `gh api` si un projet en a plus.
const ISSUE_LIMIT = 1000
const issueList = z.array(
  z.object({
    number: z.number().int().positive(),
    title: z.string(),
    body: z.string(),
    state: z.enum(['OPEN', 'CLOSED']),
    url: z.url({ protocol: /^https$/ }),
  }),
)
type Issue = z.infer<typeof issueList>[number]

async function fetchIssues(repo: string): Promise<Issue[]> {
  const result = await gh(repo, ['issue', 'list', '--state', 'all', '--limit', String(ISSUE_LIMIT), '--json', ISSUE_FIELDS])
  if (result.code !== 0) throw new Error(result.error)
  return issueList.parse(JSON.parse(result.stdout))
}

const toTask = ({ number, title, body, state, url }: Issue): IssueTask => ({
  title, body: body.slice(0, TASK_BODY_MAX_LENGTH), status: state === 'CLOSED' ? 'done' : 'todo', issueNumber: number, issueUrl: url,
})

// Les issues sont liées par numéro : réimporter met à jour les tâches existantes.
export async function syncIssues(db: DatabaseSync, projectId: string): Promise<void> {
  const issues = await fetchIssues(await checkedProjectPath(db, projectId))
  const tasks = createTasks(db)
  for (const issue of issues) tasks.saveIssue(projectId, toTask(issue))
}
