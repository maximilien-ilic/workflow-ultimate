import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
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

// Lecture seule d'une base de profil Orca. Son contenu est traité comme non fiable : tout est validé.
export function readOrcaProfile(file: string): OrcaImport {
  const result = empty()
  let docs: Map<string, string>
  try {
    const db = new DatabaseSync(file, { readOnly: true })
    try {
      const rows = db.prepare('SELECT domain, payload FROM profile_state_documents').all() as {
        domain: string
        payload: string
      }[]
      docs = new Map(rows.map((r) => [r.domain, r.payload]))
    } finally {
      db.close()
    }
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
  for (const profile of readdirSync(profilesDir, { withFileTypes: true })) {
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
