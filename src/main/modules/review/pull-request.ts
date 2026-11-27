import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import type { PullRequestContext } from '../../../shared/ipc'
import { remoteGitEnv, runGit } from '../projects/git-env'

const exec = promisify(execFile)
const GH_TIMEOUT_MS = 15_000
// Sans limite explicite, Node coupe la sortie à 1 Mio ; une longue liste d'issues peut dépasser cette taille.
export const GH_MAX_OUTPUT_BYTES = 16 * 1024 * 1024
const MAX_BUFFER_EXCEEDED = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
const PUSH_REQUIRED = 'Poussez le commit courant vers GitHub avant de créer sa pull request.'
const PR_HISTORY_LIMIT = 100
const HEAD_REF_PREFIX = 'refs/heads/'
const pullRequestUrl = z.string().regex(/^https:\/\/github\.com\/[a-z\d_.-]+\/[a-z\d_.-]+\/pull\/\d+$/i)
const pullRequest = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  url: pullRequestUrl,
  state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
  headRepository: z.object({ nameWithOwner: z.string() }).nullish(),
})
const trackedPullRequest = pullRequest.extend({ mergedAt: z.iso.datetime().nullish() })
const checks = z.array(z.object({ name: z.string(), bucket: z.enum(['pass', 'fail', 'pending', 'skipping', 'cancel']) }))

export async function gh(repo: string, args: string[]) {
  const env = remoteGitEnv()
  delete env.GH_REPO
  delete env.GH_HOST
  const command = exec('gh', args, {
    cwd: repo, env: { ...env, GH_PROMPT_DISABLED: '1' }, timeout: GH_TIMEOUT_MS, maxBuffer: GH_MAX_OUTPUT_BYTES,
  })
  command.child.stdin?.end()
  try {
    const { stdout } = await command
    return { stdout: stdout.trim(), error: '', code: 0 }
  } catch (cause) {
    const { code, stdout, stderr, message } = cause as NodeJS.ErrnoException & { stdout?: string; stderr?: string }
    if (code === MAX_BUFFER_EXCEEDED)
      return { stdout: '', error: `La sortie de gh dépasse la limite de ${GH_MAX_OUTPUT_BYTES} octets.`, code }
    return { stdout: stdout?.trim() ?? '', error: stderr?.trim() || message || String(cause), code }
  }
}

async function currentBranch(repo: string): Promise<string> {
  return runGit(repo, ['branch', '--show-current'])
}

async function readChecks(repo: string, url: string) {
  const result = await gh(repo, ['pr', 'checks', url, '--json', 'name,bucket'])
  if (result.stdout && [0, 1, 8].includes(Number(result.code))) return checks.parse(JSON.parse(result.stdout))
  if (/^no checks reported\b/i.test(result.error)) return []
  throw new Error(result.error || 'GitHub ne renvoie aucun état de CI.')
}

function githubRepository(value: string): string | undefined {
  const url = URL.parse(value.replace(/^([\w.-]+@github\.com):/i, 'ssh://$1/'))
  if (!url || url.hostname !== 'github.com' || !['https:', 'ssh:'].includes(url.protocol)) return
  return /^\/([\w.-]+\/[\w.-]+)\/?$/.exec(url.pathname.replace(/\.git\/?$/, ''))?.[1]
}

async function pullRequestTarget(repo: string, branch: string) {
  const localRef = HEAD_REF_PREFIX + branch
  const [upstream, selectedRepo] = await Promise.all([
    runGit(repo, ['for-each-ref', '--format=%(upstream:remotename)%00%(upstream:remoteref)', localRef]),
    gh(repo, ['repo', 'view', '--json', 'url']),
  ])
  if (selectedRepo.code !== 0) throw new Error(selectedRepo.error)
  const repository = githubRepository(z.object({ url: z.string() }).parse(JSON.parse(selectedRepo.stdout)).url)
  if (!repository) throw new Error('La création de PR est disponible pour les dépôts GitHub.com.')
  const [remote, configuredRef] = upstream.split('\0')
  const ref = configuredRef || localRef
  if (remote === '.' || !ref.startsWith(HEAD_REF_PREFIX)) throw new Error(PUSH_REQUIRED)
  const pushUrls = await runGit(repo, ['remote', 'get-url', '--push', '--all', '--', remote || 'origin'])
  if (pushUrls.split('\n').some((url) => githubRepository(url)?.toLowerCase() !== repository.toLowerCase()))
    throw new Error('Le distant de push doit viser le même dépôt GitHub. La création depuis un fork est hors périmètre.')
  return { repository, head: ref.slice(HEAD_REF_PREFIX.length) }
}

type PullRequestTarget = Awaited<ReturnType<typeof pullRequestTarget>>

async function listBranchPullRequests(repo: string, { repository, head }: PullRequestTarget, args: string[]) {
  const result = await gh(repo, ['pr', 'list', `--repo=github.com/${repository}`, `--head=${head}`, ...args])
  if (result.code !== 0) throw new Error(result.error)
  return JSON.parse(result.stdout) as unknown
}

function sameRepository(pr: z.infer<typeof pullRequest>, repository: string): boolean {
  return pr.headRepository?.nameWithOwner.toLowerCase() === repository.toLowerCase()
}

export async function readBranchPullRequest(repo: string, branch: string, startedAt: number): Promise<'OPEN' | 'MERGED' | undefined> {
  if (!(await runGit(repo, ['remote']))) return
  const target = await pullRequestTarget(repo, branch)
  // shortcut: les 100 dernières PR de cette branche suffisent ; paginer si une branche est réutilisée davantage.
  const result = await listBranchPullRequests(repo, target, [
    '--state=all', `--limit=${PR_HISTORY_LIMIT}`, '--json', 'number,title,url,state,headRepository,mergedAt',
  ])
  const matching = trackedPullRequest.array().parse(result).filter((pr) => sameRepository(pr, target.repository))
  if (matching.some(({ state }) => state === 'OPEN')) return 'OPEN'
  // Une fusion antérieure au démarrage peut concerner une ancienne utilisation de la branche.
  if (matching.some(({ state, mergedAt }) => state === 'MERGED' && mergedAt && Date.parse(mergedAt) >= startedAt))
    return 'MERGED'
}

async function draftFor(repo: string, branch: string): Promise<PullRequestContext> {
  const [title = branch, ...parts] = (await runGit(repo, ['log', '-1', '--no-merges', '--format=%s%x00%b'])).split('\0')
  const body = parts.join('\0').trim()
  const issue = /^(?:feat|fix|chore)\/(\d+)(?:-|$)/.exec(branch)?.[1]
  const closes = issue && `Closes #${issue}`
  const hasClosingLine = closes && body.split('\n').some((line) => line.trim().toLowerCase() === closes.toLowerCase())
  const description = closes && !hasClosingLine
    ? [body.slice(0, 20_000 - closes.length - 2), closes].filter(Boolean).join('\n\n')
    : body.slice(0, 20_000)
  return { kind: 'draft', branch, title: (title || branch).slice(0, 256), body: description }
}

export async function readPullRequest(repo: string): Promise<PullRequestContext> {
  const [branch, remotes] = await Promise.all([currentBranch(repo), runGit(repo, ['remote'])])
  if (!branch) return { kind: 'unavailable', message: 'Sélectionnez un worktree rattaché à une branche.' }
  if (!remotes) return { kind: 'unavailable', message: 'Aucun dépôt distant configuré.' }
  const target = await pullRequestTarget(repo, branch)
  const result = await listBranchPullRequests(repo, target, ['--state=open', '--json', 'number,title,url,state,headRepository'])
  const pr = pullRequest.array().parse(result).find((pr) => pr.state === 'OPEN' && sameRepository(pr, target.repository))
  if (!pr) return draftFor(repo, branch)
  const { number, title, url, state } = pr
  return { kind: 'existing', number, title, url, state, checks: await readChecks(repo, url) }
}

export async function createPullRequest(repo: string, expectedBranch: string, title: string, body: string) {
  const branch = await currentBranch(repo)
  if (branch !== expectedBranch) throw new Error('La branche a changé. Rafraîchissez le panneau de contexte.')
  const { repository, head } = await pullRequestTarget(repo, branch)
  await assertPublished(repo, repository, head)
  if (await currentBranch(repo) !== branch) throw new Error('La branche a changé. Rafraîchissez le panneau de contexte.')
  // shortcut: GitHub crée une PR depuis un nom de branche. La vérification est un instantané
  // jusqu'à ce que l'API accepte de conditionner la création à un SHA.
  const result = await gh(repo, [
    'pr', 'create', `--repo=github.com/${repository}`, `--head=${head}`, `--title=${title}`, `--body=${body}`,
  ])
  if (result.code !== 0) throw new Error(result.error)
  return { url: pullRequestUrl.parse(result.stdout) }
}

async function assertPublished(repo: string, repository: string, head: string) {
  const ref = head.split('/').map(encodeURIComponent).join('/')
  const result = await gh(repo, ['api', '--hostname', 'github.com', `repos/${repository}/git/ref/heads/${ref}`])
  if (result.code !== 0) {
    if (/\(HTTP 404\)/.test(result.error)) throw new Error(PUSH_REQUIRED)
    throw new Error(result.error)
  }
  const remote = z.object({ object: z.object({ sha: z.string() }) }).parse(JSON.parse(result.stdout))
  const local = await runGit(repo, ['rev-parse', '--verify', 'HEAD'])
  if (remote.object.sha !== local) throw new Error(PUSH_REQUIRED)
}
