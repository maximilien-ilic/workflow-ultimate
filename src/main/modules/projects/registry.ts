import { randomUUID } from 'node:crypto'
import { access, readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { Project } from '../../../shared/ipc'
import { runGit } from './git-env'

const git = (cwd: string, ...args: string[]) => runGit(cwd, args, 5000)

export type RepoInfo = { root: string; gitDir: string }

// Identité d'un dépôt : son dossier git commun (le même depuis un sous-dossier ou un worktree lié).
// Racine : le dossier de travail principal. shortcut: avec --separate-git-dir, git ne connaît pas le dossier
// principal depuis un worktree lié ; on prend alors celui du worktree, et la déduplication passe par gitDir.
export async function repoInfo(path: string): Promise<RepoInfo> {
  try {
    await stat(path)
  } catch {
    throw new Error(`Dossier introuvable : ${path}`)
  }
  let gitDir: string, ownGitDir: string, toplevel: string
  try {
    gitDir = await git(path, 'rev-parse', '--path-format=absolute', '--git-common-dir')
    ownGitDir = await git(path, 'rev-parse', '--path-format=absolute', '--git-dir')
    toplevel = await git(path, 'rev-parse', '--show-toplevel')
  } catch {
    throw new Error(`${path} n'est pas un dépôt git (ou c'est un dépôt nu, sans dossier de travail)`)
  }
  // Dans le worktree principal, --show-toplevel est toujours juste (même avec un --separate-git-dir nommé .git).
  if (ownGitDir === gitDir) return { gitDir, root: toplevel }
  // Depuis un worktree lié : git donne le worktree principal en premier. Avec un stockage séparé, il ne le
  // connaît pas : il renvoie le stockage (ou son parent s'il s'appelle .git). shortcut: ce cas rare n'est pas
  // détectable ; l'identité par gitDir évite tout doublon, et un ajout depuis le checkout principal est juste.
  const list = await git(path, 'worktree', 'list', '--porcelain', '-z')
  const first = list.split('\0')[0]?.replace(/^worktree /, '')
  return { gitDir, root: first && first !== gitDir ? first : toplevel }
}

export const repoRoot = async (path: string) => (await repoInfo(path)).root

type Row = { id: string; path: string; git_dir: string; name: string; added_at: number }
const toProject = (r: Row): Project => ({ id: r.id, path: r.path, name: r.name, addedAt: r.added_at })

export async function addProject(db: DatabaseSync, path: string): Promise<Project> {
  const { root, gitDir } = await repoInfo(path)
  db.prepare('INSERT OR IGNORE INTO projects (id, path, git_dir, name, added_at) VALUES (?, ?, ?, ?, ?)').run(
    randomUUID(),
    root,
    gitDir,
    basename(root),
    Date.now(),
  )
  return toProject(
    db.prepare('SELECT * FROM projects WHERE git_dir = ? OR path = ?').get(gitDir, root) as Row,
  )
}

export function listProjects(db: DatabaseSync): Project[] {
  return (db.prepare('SELECT * FROM projects ORDER BY name COLLATE NOCASE, path').all() as Row[]).map(
    toProject,
  )
}

function projectRow(db: DatabaseSync, id: string): Row {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Row | undefined
  if (!row) throw new Error(`Projet ${id} inconnu`)
  return row
}

export const getProject = (db: DatabaseSync, id: string): Project => toProject(projectRow(db, id))

// Le dossier enregistré peut avoir changé (dépôt supprimé, dossier recréé dans un autre dépôt) :
// avant d'y lancer une commande, on vérifie qu'il mène toujours au même dossier git commun.
export async function checkedProjectPath(db: DatabaseSync, id: string): Promise<string> {
  const row = projectRow(db, id)
  const { gitDir } = await repoInfo(row.path)
  if (gitDir !== row.git_dir)
    throw new Error(`${row.path} n'est plus le dépôt du projet ${row.name} : retirez-le puis ajoutez-le de nouveau.`)
  return row.path
}

export function removeProject(db: DatabaseSync, id: string): void {
  db.prepare('DELETE FROM projects WHERE id = ?').run(id)
}

const SKIPPED = new Set(['node_modules'])
const hasGitDir = (dir: string) =>
  access(join(dir, '.git')).then(
    () => true,
    () => false,
  )

// Cherche les dépôts sous `root` sans lancer git : un dossier contenant `.git` est un dépôt, on n'y descend pas.
export async function scanForRepos(root: string, maxDepth = 2): Promise<string[]> {
  if (await hasGitDir(root)) return [root]
  const found: string[] = []
  const visit = async (dir: string, depth: number): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || SKIPPED.has(entry.name)) continue
      const child = join(dir, entry.name)
      if (await hasGitDir(child)) found.push(child)
      else if (depth < maxDepth) await visit(child, depth + 1)
    }
  }
  await visit(root, 1)
  return found
}
