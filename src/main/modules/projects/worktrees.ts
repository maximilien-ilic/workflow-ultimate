import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { mkdir, realpath } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { Worktree } from '../../../shared/ipc'
import { runGit } from './git-env'

// shortcut: dossier fixe, comme Orca (~/orca/workspaces) ; à rendre réglable avec l'import Orca (#19)
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

// Ticket GitHub → nom de branche, comme dans docs/ORCHESTRATION.md : feat/<n>-<titre court>.
export function branchForIssue(issue: number, title: string): string {
  const s = slug(title)
  return s ? `feat/${issue}-${s}` : `feat/${issue}`
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
  opts: { branch: string; create: boolean; base?: string },
): Promise<string> {
  try {
    await runGit(repo, ['check-ref-format', '--branch', opts.branch])
  } catch {
    throw new Error(`Nom de branche invalide : ${opts.branch}`)
  }
  const wanted = join(workspaces, basename(repo), opts.branch.replaceAll('/', '-'))
  await mkdir(dirname(wanted), { recursive: true })
  // Chemin réel du parent : git enregistre un chemin sans lien symbolique (HOME peut en être un),
  // ce qui permet à removeWorktree de refuser tout chemin redirigé.
  const path = join(await realpath(dirname(wanted)), basename(wanted))
  if (existsSync(path)) throw new Error(`${path} existe déjà`)
  const args = opts.create
    ? ['worktree', 'add', '-b', opts.branch, path, ...(opts.base ? [opts.base] : [])]
    : ['worktree', 'add', path, opts.branch]
  try {
    await runGit(repo, args, 60_000)
  } catch (error) {
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
