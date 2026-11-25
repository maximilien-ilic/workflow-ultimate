import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { gitEnv, remoteGitEnv, runGit } from '../projects/git-env'

const exec = promisify(execFile)
const LOCAL_TIMEOUT_MS = 10_000
const PUSH_TIMEOUT_MS = 60_000

// Lance git et, en cas d'échec, remonte son propre message (stderr, ou stdout pour « rien à commiter »).
async function git(
  repo: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeout: number,
  input?: string,
): Promise<string> {
  try {
    const command = exec('git', ['-C', repo, ...args], { env, timeout, maxBuffer: 16 * 1024 * 1024 })
    if (input !== undefined) {
      // Git peut quitter avant d'avoir lu stdin. Son code de sortie donne l'erreur utile.
      command.child.stdin?.on('error', () => {})
      command.child.stdin?.end(input)
    }
    const { stdout } = await command
    return stdout
  } catch (error) {
    const { stderr, stdout } = error as { stderr?: string; stdout?: string }
    throw new Error(stderr?.trim() || stdout?.trim() || (error as Error).message, { cause: error })
  }
}

// Indexe les fichiers choisis (tous si aucune liste) puis commite ; renvoie le sha du commit.
export async function commitChanges(repo: string, message: string, paths?: string[]): Promise<string> {
  const env = gitEnv()
  if (paths) {
    // Le diff inclut aussi les commits de la branche. L'état Git distingue les chemins
    // encore modifiés, y compris l'ancien nom d'un fichier déjà renommé dans l'index.
    const pending = await git(
      repo, ['status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all'], env, LOCAL_TIMEOUT_MS,
    )
    const selected = new Set(paths)
    const scope = new Set(pending.split('\0').map((entry) => entry.slice(3)).filter((path) => selected.has(path)))
    if (!scope.size) throw new Error('Aucun changement à commiter parmi les fichiers cochés.')
    const input = [...scope].join('\0') + '\0'
    await git(repo, ['update-index', '--add', '--remove', '-z', '--stdin'], env, LOCAL_TIMEOUT_MS, input)
    await git(
      repo,
      ['--literal-pathspecs', 'commit', '--only', '--message', message, '--pathspec-from-file=-', '--pathspec-file-nul'],
      env, LOCAL_TIMEOUT_MS, input,
    )
  } else {
    await git(repo, ['add', '--all'], env, LOCAL_TIMEOUT_MS)
    await git(repo, ['commit', '--message', message], env, LOCAL_TIMEOUT_MS)
  }
  return (await git(repo, ['rev-parse', 'HEAD'], env, LOCAL_TIMEOUT_MS)).trim()
}

// Pousse la branche courante ; au premier push, crée l'upstream sur origin.
export async function pushBranch(repo: string): Promise<string> {
  const branch = await runGit(repo, ['symbolic-ref', 'HEAD'])
  const upstream = await runGit(repo, [
    'for-each-ref', '--format=%(refname)%00%(upstream:remotename)%00%(upstream:remoteref)', branch,
  ])
  const [, upstreamRemote, upstreamRef] = upstream.split('\n').find((line) => line.startsWith(branch + '\0'))
    ?.split('\0') ?? []
  const args = ['-c', 'credential.interactive=false', 'push', '--no-mirror', '--no-follow-tags', '--recurse-submodules=no']
  if (!upstreamRemote || !upstreamRef) args.push('--set-upstream')
  args.push('--', upstreamRemote || 'origin', `${branch}:${upstreamRef || branch}`)

  const env = remoteGitEnv()
  const [configuredSsh, variant] = await Promise.all([
    env.GIT_SSH_COMMAND ?? runGit(repo, ['config', '--get', 'core.sshCommand']).catch(() => ''),
    env.GIT_SSH_VARIANT ?? runGit(repo, ['config', '--get', 'ssh.variant']).catch(() => 'auto'),
  ])
  // shortcut: une commande SSH personnalisée ou un helper qui ignore le mode non interactif
  // doit implémenter ce mode lui-même, jusqu'à la prise en charge explicite de son transport.
  if (variant === 'ssh' || variant === 'auto') {
    if (configuredSsh) env.GIT_SSH_COMMAND = `${configuredSsh} -o BatchMode=yes`
    else if (!env.GIT_SSH) env.GIT_SSH_COMMAND = 'ssh -o BatchMode=yes'
  }
  return (await git(repo, args, env, PUSH_TIMEOUT_MS)).trim()
}
