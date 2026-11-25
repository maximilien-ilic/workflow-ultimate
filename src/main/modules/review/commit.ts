import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { gitEnv, remoteGitEnv } from '../projects/git-env'

const exec = promisify(execFile)
const LOCAL_TIMEOUT_MS = 10_000
const PUSH_TIMEOUT_MS = 60_000

// Lance git et, en cas d'échec, remonte son propre message (stderr, ou stdout pour « rien à commiter »).
async function git(repo: string, args: string[], env: NodeJS.ProcessEnv, timeout: number): Promise<string> {
  try {
    const { stdout } = await exec('git', ['-C', repo, ...args], { env, timeout })
    return stdout.trim()
  } catch (error) {
    const { stderr, stdout } = error as { stderr?: string; stdout?: string }
    throw new Error(stderr?.trim() || stdout?.trim() || (error as Error).message, { cause: error })
  }
}

// Indexe les fichiers choisis (tous si aucune liste) puis commite ; renvoie le sha du commit.
export async function commitChanges(repo: string, message: string, paths?: string[]): Promise<string> {
  const scope = paths ? ['--', ...paths] : []
  await git(repo, ['add', '--all', ...scope], gitEnv(), LOCAL_TIMEOUT_MS)
  await git(repo, ['commit', '--message', message, ...scope], gitEnv(), LOCAL_TIMEOUT_MS)
  return git(repo, ['rev-parse', 'HEAD'], gitEnv(), LOCAL_TIMEOUT_MS)
}

// Pousse la branche courante ; au premier push, crée l'upstream sur origin.
export async function pushBranch(repo: string): Promise<string> {
  const hasUpstream = await git(
    repo,
    ['rev-parse', '--abbrev-ref', '@{upstream}'],
    gitEnv(),
    LOCAL_TIMEOUT_MS,
  ).then(
    () => true,
    () => false,
  )
  const args = hasUpstream ? ['push'] : ['push', '--set-upstream', 'origin', 'HEAD']
  return git(repo, args, remoteGitEnv(), PUSH_TIMEOUT_MS)
}
