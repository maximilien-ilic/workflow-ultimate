import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { TASK_BODY_MAX_LENGTH } from '../../../shared/ipc'
import { bindGithubRepo, checkedProjectPath } from '../projects/registry'
import { gh } from '../review/pull-request'
import { createTasks, type IssueTask } from './tasks'

export const ISSUES_PER_PAGE = 100 // maximum accepté par l'API GitHub
// shortcut: au-delà de 10 pages (1000 issues), les plus anciennes sont ignorées ; augmenter si un projet en a plus.
const MAX_ISSUE_PAGES = 10
// gh écarte les pull requests (aussi listées par /issues) et tronque les corps : chaque page reste bornée.
// `count` compte la page brute, pour savoir si GitHub en a d'autres.
const PAGE_FILTER = '{count: length, issues: [.[] | select(.pull_request | not) | '
  + `{number, title, body: ((.body // "")[0:${TASK_BODY_MAX_LENGTH}]), state, url: .html_url}]}`

const githubRepo = z.object({ nameWithOwner: z.string().regex(/^[\w.-]+\/[\w.-]+$/) })
const issuePage = z.object({
  count: z.number().int().min(0),
  issues: z.array(
    z.object({
      number: z.number().int().positive(),
      title: z.string(),
      body: z.string(),
      state: z.enum(['open', 'closed']),
      url: z.url({ protocol: /^https$/ }),
    }),
  ),
})
type Issue = z.infer<typeof issuePage>['issues'][number]

async function runGh(path: string, args: string[]): Promise<unknown> {
  const result = await gh(path, args)
  if (result.code !== 0) throw new Error(result.error)
  return JSON.parse(result.stdout)
}

async function readGithubRepo(path: string): Promise<string> {
  return githubRepo.parse(await runGh(path, ['repo', 'view', '--json', 'nameWithOwner'])).nameWithOwner
}

async function fetchIssuePage(path: string, source: string, page: number) {
  const query = `repos/${source}/issues?state=all&per_page=${ISSUES_PER_PAGE}&page=${page}`
  return issuePage.parse(await runGh(path, ['api', '--hostname', 'github.com', query, '--jq', PAGE_FILTER]))
}

// Le jq de gh compte en caractères Unicode, la limite en unités UTF-16 : on retronque ici.
const toTask = ({ number, title, body, state, url }: Issue): IssueTask => ({
  title,
  body: body.slice(0, TASK_BODY_MAX_LENGTH),
  status: state === 'closed' ? 'done' : 'todo',
  issueNumber: number,
  issueUrl: url,
})

// Les issues sont liées par numéro : réimporter met à jour les tâches existantes, page par page.
export async function syncIssues(db: DatabaseSync, projectId: string): Promise<void> {
  const path = await checkedProjectPath(db, projectId)
  const source = await readGithubRepo(path)
  bindGithubRepo(db, projectId, source)
  const tasks = createTasks(db)
  for (let page = 1; page <= MAX_ISSUE_PAGES; page++) {
    const { count, issues } = await fetchIssuePage(path, source, page)
    for (const issue of issues) tasks.saveIssue(projectId, toTask(issue))
    if (count < ISSUES_PER_PAGE) return
  }
}
