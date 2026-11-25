import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import type { PullRequestContext } from '../../../shared/ipc'
import { remoteGitEnv, runGit } from '../projects/git-env'

const exec = promisify(execFile)
const GH_TIMEOUT_MS = 15_000
const pullRequestUrl = z.string().regex(/^https:\/\/github\.com\/[a-z\d_.-]+\/[a-z\d_.-]+\/pull\/\d+$/i)
const pullRequest = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  url: pullRequestUrl,
  state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
})
const checks = z.array(z.object({ name: z.string(), bucket: z.enum(['pass', 'fail', 'pending', 'skipping', 'cancel']) }))

async function gh(repo: string, args: string[]) {
  const env = remoteGitEnv()
  delete env.GH_REPO
  delete env.GH_HOST
  const command = exec('gh', ['pr', ...args], {
    cwd: repo, env: { ...env, GH_PROMPT_DISABLED: '1' }, timeout: GH_TIMEOUT_MS,
  })
  command.child.stdin?.end()
  try {
    const { stdout } = await command
    return { stdout: stdout.trim(), error: '', code: 0 }
  } catch (cause) {
    const { code, stdout, stderr, message } = cause as NodeJS.ErrnoException & { stdout?: string; stderr?: string }
    return { stdout: stdout?.trim() ?? '', error: stderr?.trim() || message || String(cause), code }
  }
}

async function currentBranch(repo: string): Promise<string> {
  return runGit(repo, ['branch', '--show-current'])
}

async function readChecks(repo: string, url: string) {
  const result = await gh(repo, ['checks', url, '--json', 'name,bucket'])
  if (result.stdout && [0, 1, 8].includes(Number(result.code))) return checks.parse(JSON.parse(result.stdout))
  if (/^no checks reported\b/i.test(result.error)) return []
  throw new Error(result.error || 'GitHub ne renvoie aucun état de CI.')
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
  const result = await gh(repo, ['view', '--json', 'number,title,url,state'])
  if (result.code === 1 && /^no pull requests found\b/i.test(result.error)) return draftFor(repo, branch)
  if (result.code !== 0) throw new Error(result.error)
  const pr = pullRequest.parse(JSON.parse(result.stdout))
  return { kind: 'existing', ...pr, checks: await readChecks(repo, pr.url) }
}

export async function createPullRequest(repo: string, expectedBranch: string, title: string, body: string) {
  const branch = await currentBranch(repo)
  if (branch !== expectedBranch) throw new Error('La branche a changé. Rafraîchissez le panneau de contexte.')
  // shortcut: la branche amont doit appartenir au dépôt cible, jusqu’à la sélection explicite des forks.
  const upstream = await runGit(repo, [
    'for-each-ref', '--format=%(upstream:remotename)%00%(upstream:remoteref)', `refs/heads/${branch}`,
  ])
  const [remote, ref] = upstream.split('\0')
  if (!remote || remote === '.' || !ref?.startsWith('refs/heads/'))
    throw new Error('Poussez la branche avant de créer sa pull request.')
  const head = ref.slice('refs/heads/'.length)
  const result = await gh(repo, ['create', `--head=${head}`, `--title=${title}`, `--body=${body}`])
  if (result.code !== 0) throw new Error(result.error)
  return { url: pullRequestUrl.parse(result.stdout) }
}
