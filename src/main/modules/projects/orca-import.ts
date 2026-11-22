import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, type Dirent } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'

export type OrcaImport = {
  repos: { path: string; name: string; color: string | null }[]
  worktrees: { repoPath: string; path: string; name: string }[]
  workspaceDir: string | null
  warnings: string[]
}

const absolute = z.string().startsWith('/')
const repoEntry = z.object({
  id: z.string(),
  path: absolute,
  kind: z.string(),
  displayName: z.string().optional(),
  badgeColor: z.string().optional(),
})
const worktreeEntry = z.object({ displayName: z.string().optional() })

const empty = (): OrcaImport => ({ repos: [], worktrees: [], workspaceDir: null, warnings: [] })

// Même en lecture seule, SQLite peut créer -wal/-shm à côté d'une base en WAL : on lit donc une copie
// (base + WAL éventuel) dans un dossier temporaire, et le profil d'Orca n'est jamais touché.
function readSnapshot(file: string): Map<string, string> {
  const tmp = mkdtempSync(join(tmpdir(), 'wu-orca-'))
  try {
    const copy = join(tmp, 'profile-state.db')
    copyFileSync(file, copy)
    if (existsSync(`${file}-wal`)) copyFileSync(`${file}-wal`, `${copy}-wal`)
    const db = new DatabaseSync(copy)
    try {
      const rows = db.prepare('SELECT domain, payload FROM profile_state_documents').all() as {
        domain: string
        payload: string
      }[]
      return new Map(rows.map((r) => [r.domain, r.payload]))
    } finally {
      db.close()
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

// Lecture d'une base de profil Orca. Son contenu est traité comme non fiable : tout est validé.
export function readOrcaProfile(file: string): OrcaImport {
  const result = empty()
  let docs: Map<string, string>
  try {
    docs = readSnapshot(file)
  } catch (error) {
    result.warnings.push(`${file} : format Orca non reconnu (${(error as Error).message})`)
    return result
  }

  const parse = (domain: string): unknown => {
    const raw = docs.get(domain)
    if (raw === undefined) return undefined
    try {
      return JSON.parse(raw)
    } catch {
      result.warnings.push(`${file} : « ${domain} » illisible, ignoré`)
      return undefined
    }
  }

  const repoById = new Map<string, string>()
  const rawRepos = parse('repos')
  if (Array.isArray(rawRepos)) {
    let invalid = 0
    for (const entry of rawRepos) {
      const repo = repoEntry.safeParse(entry)
      if (!repo.success) invalid++
      else if (repo.data.kind === 'git') {
        repoById.set(repo.data.id, repo.data.path)
        result.repos.push({
          path: repo.data.path,
          name: repo.data.displayName || basename(repo.data.path),
          color: repo.data.badgeColor ?? null,
        })
      }
    }
    if (invalid) result.warnings.push(`${file} : ${invalid} dépôt(s) ignoré(s), format inattendu`)
  }

  const rawWorktrees = parse('worktreeMeta')
  if (rawWorktrees && typeof rawWorktrees === 'object') {
    for (const [key, value] of Object.entries(rawWorktrees)) {
      // Clé Orca : `<repoId>::<chemin du worktree>`.
      const sep = key.indexOf('::')
      const repoPath = repoById.get(key.slice(0, sep))
      const path = key.slice(sep + 2)
      const meta = worktreeEntry.safeParse(value)
      if (sep < 0 || !repoPath || path === repoPath || !absolute.safeParse(path).success || !meta.success) continue
      result.worktrees.push({ repoPath, path, name: meta.data.displayName || basename(path) })
    }
  }

  const settings = parse('settings')
  const workspaceDir = absolute.safeParse((settings as { workspaceDir?: unknown } | undefined)?.workspaceDir)
  result.workspaceDir = workspaceDir.success ? workspaceDir.data : null
  return result
}

// Tous les profils Orca de la machine, fusionnés sans doublon. Orca absent : résultat vide.
export function readOrcaConfig(
  configHome = process.env['XDG_CONFIG_HOME'] || join(homedir(), '.config'),
): OrcaImport {
  const profilesDir = join(configHome, 'orca/profiles')
  const merged = empty()
  if (!existsSync(profilesDir)) return merged
  let profiles: Dirent[]
  try {
    profiles = readdirSync(profilesDir, { withFileTypes: true })
  } catch (error) {
    merged.warnings.push(`${profilesDir} illisible : ${(error as Error).message}`)
    return merged
  }
  for (const profile of profiles) {
    const file = join(profilesDir, profile.name, 'profile-state.db')
    if (!profile.isDirectory() || !existsSync(file)) continue
    const one = readOrcaProfile(file)
    for (const repo of one.repos) if (!merged.repos.some((r) => r.path === repo.path)) merged.repos.push(repo)
    for (const wt of one.worktrees) if (!merged.worktrees.some((w) => w.path === wt.path)) merged.worktrees.push(wt)
    merged.workspaceDir ??= one.workspaceDir
    merged.warnings.push(...one.warnings)
  }
  return merged
}
