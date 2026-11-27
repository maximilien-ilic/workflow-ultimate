import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { homedir } from 'node:os'
import { mkdir, mkdtemp, realpath, rmdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { Worktree } from '../../../shared/ipc'
import { remoteGitEnv, runGit } from './git-env'

const exec = promisify(execFile)
const ISSUE_LOOKUP_TIMEOUT_MS = 15_000

export async function issueBranch(repo: string, issue: number, source?: string): Promise<string> {
  const args = ['issue', 'view', String(issue), '--json', 'title', '-q', '.title']
  const env = source ? remoteGitEnv() : undefined
  if (env && source) {
    delete env.GH_HOST
    delete env.GH_REPO
    args.push(`--repo=github.com/${source}`)
  }
  try {
    const { stdout } = await exec('gh', args, { cwd: repo, env, timeout: ISSUE_LOOKUP_TIMEOUT_MS })
    return branchForIssue(issue, stdout.trim())
  } catch (error) {
    throw new Error(`Ticket #${issue} introuvable avec gh : ${(error as Error).message}`, { cause: error })
  }
}

// Repli tant qu'aucun dossier de workspaces n'a été importé.
export const defaultWorkspaces = () => join(homedir(), 'workflow-ultimate', 'workspaces')

export async function branchExists(repo: string, branch: string): Promise<boolean> {
  return runGit(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).then(
    () => true,
    () => false,
  )
}

export class DirtyWorktreeError extends Error {
  constructor(
    path: string,
    readonly files: number,
  ) {
    super(`${path} contient ${files} fichier(s) non commité(s) : confirmer pour les perdre`)
    this.name = 'DirtyWorktreeError'
  }
}

function slug(text: string): string {
  const full = text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  if (full.length <= 40) return full
  const cut = full.slice(0, 41).lastIndexOf('-') // couper entre deux mots quand c'est possible
  return cut > 0 ? full.slice(0, cut) : full.slice(0, 40)
}

function namedBranch(prefix: string, title: string): string {
  const suffix = slug(title)
  return suffix ? `${prefix}-${suffix}` : prefix
}

// Ticket GitHub → nom de branche, comme dans docs/ORCHESTRATION.md : feat/<n>-<titre court>.
export function branchForIssue(issue: number, title: string): string {
  return namedBranch(`feat/${issue}`, title)
}

export function branchForLocalTask(id: number, title: string): string {
  return namedBranch(`feat/task-${id}`, title)
}

export async function listWorktrees(repo: string): Promise<Worktree[]> {
  const out = await runGit(repo, ['worktree', 'list', '--porcelain', '-z'])
  const worktrees: Worktree[] = []
  for (const field of out.split('\0')) {
    if (field.startsWith('worktree '))
      worktrees.push({ path: field.slice('worktree '.length), branch: null, main: worktrees.length === 0 })
    else if (field.startsWith('branch refs/heads/') && worktrees.length)
      worktrees[worktrees.length - 1]!.branch = field.slice('branch refs/heads/'.length)
  }
  return worktrees
}

export async function createWorktree(
  repo: string,
  workspaces: string,
  opts: { branch: string; create?: boolean; base?: string },
): Promise<string> {
  try {
    await runGit(repo, ['check-ref-format', '--branch', opts.branch])
  } catch {
    throw new Error(`Nom de branche invalide : ${opts.branch}`)
  }
  const parent = join(workspaces, basename(repo))
  await mkdir(parent, { recursive: true })
  // Chemin réel du parent : git enregistre un chemin sans lien symbolique (HOME peut en être un),
  // ce qui permet à removeWorktree de refuser tout chemin redirigé.
  const realParent = await realpath(parent)
  const name = opts.branch.replaceAll('/', '-')
  let path = join(realParent, name)
  try {
    // Réserver le dossier avant git, qui accepterait un dossier vide déjà présent.
    await mkdir(path)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EEXIST' && code !== 'ENAMETOOLONG') throw error
    // Avec le suffixe de mkdtemp, 80 unités UTF-16 tiennent encore dans 255 octets UTF-8.
    path = await mkdtemp(join(realParent, `${name.slice(0, 80)}-`))
  }
  const create = opts.create ?? !(await branchExists(repo, opts.branch))
  const args = create
    ? ['worktree', 'add', '-b', opts.branch, path, ...(opts.base ? [opts.base] : [])]
    : ['worktree', 'add', path, opts.branch]
  try {
    await runGit(repo, args, 60_000)
  } catch (error) {
    await rmdir(path).catch(() => {}) // Ne retirer que la réservation si elle est encore vide.
    throw new Error(
      `Création du worktree impossible : ${(error as { stderr?: string }).stderr?.trim() || error}`,
      { cause: error },
    )
  }
  return path
}

// Ne supprime qu'un worktree lié de ce dépôt (jamais le principal, jamais un dossier quelconque).
export async function removeWorktree(repo: string, path: string, opts: { force: boolean }): Promise<void> {
  const target = (await listWorktrees(repo)).find((w) => w.path === path)
  if (!target) throw new Error(`${path} n'est pas un worktree de ce projet`)
  if (target.main) throw new Error(`${path} est le worktree principal : il ne se supprime pas`)
  if (!opts.force) {
    const status = await runGit(path, ['status', '--porcelain', '-z', '--untracked-files=normal'])
    const files = status.split('\0').filter(Boolean).length
    if (files > 0) throw new DirtyWorktreeError(path, files)
  }
  // Juste avant de supprimer : le chemin enregistré ne doit passer par aucun lien symbolique,
  // sinon la suppression viserait un autre dossier que le worktree.
  const real = await realpath(path).catch(() => path)
  if (real !== path) throw new Error(`${path} passe par un lien symbolique (${real}) : suppression refusée`)
  // `worktree remove` nettoie l'enregistrement de CE worktree ; pas de `prune` global, qui effacerait
  // aussi les worktrees temporairement absents (disque démonté…).
  await runGit(repo, ['worktree', 'remove', ...(opts.force ? ['--force'] : []), path], 60_000)
}
