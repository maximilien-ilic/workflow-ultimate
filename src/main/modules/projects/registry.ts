import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, readdir, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { promisify } from 'node:util'
import type { Project } from '../../../shared/ipc'

const exec = promisify(execFile)

// Racine du dépôt principal : un sous-dossier ou un worktree lié ramène au même projet.
export async function repoRoot(path: string): Promise<string> {
  try {
    await stat(path)
  } catch {
    throw new Error(`Dossier introuvable : ${path}`)
  }
  let stdout: string
  try {
    ;({ stdout } = await exec(
      'git',
      ['-C', path, 'rev-parse', '--path-format=absolute', '--git-common-dir', '--show-toplevel'],
      { timeout: 5000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
    ))
  } catch {
    throw new Error(`${path} n'est pas un dépôt git`)
  }
  const [commonDir = '', toplevel = ''] = stdout.trim().split('\n')
  return basename(commonDir) === '.git' ? dirname(commonDir) : toplevel
}

type Row = { id: string; path: string; name: string; added_at: number }
const toProject = (r: Row): Project => ({ id: r.id, path: r.path, name: r.name, addedAt: r.added_at })

export async function addProject(db: DatabaseSync, path: string): Promise<Project> {
  const root = await repoRoot(path)
  db.prepare('INSERT OR IGNORE INTO projects (id, path, name, added_at) VALUES (?, ?, ?, ?)').run(
    randomUUID(),
    root,
    basename(root),
    Date.now(),
  )
  return toProject(db.prepare('SELECT * FROM projects WHERE path = ?').get(root) as Row)
}

export function listProjects(db: DatabaseSync): Project[] {
  return (db.prepare('SELECT * FROM projects ORDER BY name COLLATE NOCASE, path').all() as Row[]).map(toProject)
}

export function removeProject(db: DatabaseSync, id: string): void {
  db.prepare('DELETE FROM projects WHERE id = ?').run(id)
}

const SKIPPED = new Set(['node_modules'])

// Cherche les dépôts sous `root` sans lancer git : un dossier contenant `.git` est un dépôt, on n'y descend pas.
export async function scanForRepos(root: string, maxDepth = 2): Promise<string[]> {
  const found: string[] = []
  const visit = async (dir: string, depth: number): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || SKIPPED.has(entry.name)) continue
      const child = join(dir, entry.name)
      const isRepo = await access(join(child, '.git')).then(
        () => true,
        () => false,
      )
      if (isRepo) found.push(child)
      else if (depth < maxDepth) await visit(child, depth + 1)
    }
  }
  await visit(root, 1)
  return found
}
