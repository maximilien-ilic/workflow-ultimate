import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, readdir, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { promisify } from 'node:util'
import type { Project } from '../../../shared/ipc'

const exec = promisify(execFile)

const git = async (cwd: string, ...args: string[]) => {
  const { stdout } = await exec('git', ['-C', cwd, ...args], {
    timeout: 5000,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  })
  return stdout.endsWith('\n') ? stdout.slice(0, -1) : stdout // un seul chemin par appel : un \n dans un nom reste intact
}

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
  let gitDir: string, toplevel: string
  try {
    gitDir = await git(path, 'rev-parse', '--path-format=absolute', '--git-common-dir')
    toplevel = await git(path, 'rev-parse', '--show-toplevel')
  } catch {
    throw new Error(`${path} n'est pas un dépôt git (ou c'est un dépôt nu, sans dossier de travail)`)
  }
  return { gitDir, root: basename(gitDir) === '.git' ? dirname(gitDir) : toplevel }
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
