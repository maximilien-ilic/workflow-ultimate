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

const GITHUB_HOST = 'github.com'
const githubRepo = z.object({ nameWithOwner: z.string().regex(/^[\w.-]+\/[\w.-]+$/), url: z.url() })
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

// Les issues sont lues sur l'API de github.com : un dépôt GitHub Enterprise est refusé plutôt que
// confondu avec un homonyme de github.com.
async function readGithubRepo(path: string): Promise<string> {
  const { nameWithOwner, url } = githubRepo.parse(await runGh(path, ['repo', 'view', '--json', 'nameWithOwner,url']))
  const host = new URL(url).hostname
  if (host !== GITHUB_HOST)
    throw new Error(`Dépôt hébergé sur ${host} : seul ${GITHUB_HOST} est pris en charge pour l'import des issues.`)
  return nameWithOwner
}

async function fetchIssuePage(path: string, source: string, page: number) {
  const query = `repos/${source}/issues?state=all&per_page=${ISSUES_PER_PAGE}&page=${page}`
  return issuePage.parse(await runGh(path, ['api', '--hostname', GITHUB_HOST, query, '--jq', PAGE_FILTER]))
}

// Le jq de gh compte en caractères Unicode, la limite en unités UTF-16 : on retronque ici.
const toTask = ({ number, title, body, state, url }: Issue): IssueTask => ({
  title,
  body: body.slice(0, TASK_BODY_MAX_LENGTH),
  status: state === 'closed' ? 'done' : 'todo',
  issueNumber: number,
  issueUrl: url,
})

// Toutes les pages (bornées) sont lues et validées avant d'écrire : un refus en cours de route n'importe rien.
async function fetchAllIssues(path: string, source: string): Promise<Issue[]> {
  const issues: Issue[] = []
  for (let page = 1; page <= MAX_ISSUE_PAGES; page++) {
    const result = await fetchIssuePage(path, source, page)
    issues.push(...result.issues)
    if (result.count < ISSUES_PER_PAGE) break
  }
  return issues
}

function inTransaction(db: DatabaseSync, write: () => void): void {
  db.exec('BEGIN IMMEDIATE')
  try {
    write()
    db.exec('COMMIT')
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK')
    throw error
  }
}

// Les issues sont liées par numéro : réimporter met à jour les tâches existantes.
export async function syncIssues(db: DatabaseSync, projectId: string): Promise<void> {
  const path = await checkedProjectPath(db, projectId)
  const source = await readGithubRepo(path)
  const issues = await fetchAllIssues(path, source)
  const tasks = createTasks(db)
  inTransaction(db, () => {
    bindGithubRepo(db, projectId, source)
    for (const issue of issues) tasks.saveIssue(projectId, toTask(issue))
  })
}
