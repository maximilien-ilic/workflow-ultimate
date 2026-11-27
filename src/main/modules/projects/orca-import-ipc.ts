import type { WebContents } from 'electron'
import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { OrcaImport, PickResult } from '../../../shared/ipc'
import { handle } from '../shell/ipc'
import { appDirectory } from '../shell/paths'
import { readAppSettings, saveOrcaImport } from '../shell/settings'
import { readOrcaConfig } from './orca-import'
import { addProject } from './registry'
import { listWorktrees } from './worktrees'

async function preview(): Promise<OrcaImport | null> {
  const config = dirname(appDirectory('config'))
  if (!existsSync(join(config, 'orca/profiles'))) return null
  const source = readOrcaConfig(config)
  const candidates = new Map<string, typeof source.worktrees>()
  for (const worktree of source.worktrees) {
    const group = candidates.get(worktree.repoPath) ?? []
    group.push(worktree)
    candidates.set(worktree.repoPath, group)
  }

  const groups = await Promise.all(
    [...candidates].map(async ([repo, entries]) => {
      const linked = await listWorktrees(repo).catch(() => [])
      const valid = new Set(linked.filter((worktree) => !worktree.main).map(({ path }) => path))
      const states = await Promise.all(
        entries.map(async ({ path }) => {
          if (!valid.has(path)) return false
          return (await stat(path).catch(() => undefined))?.isDirectory() ?? false
        }),
      )
      return entries.filter((_, index) => states[index])
    }),
  )
  return { ...source, worktrees: groups.flat() }
}

export function registerOrcaImport(db: DatabaseSync): void {
  const visiblePreviews = new WeakMap<WebContents, Promise<OrcaImport | null>>()
  const observed = new WeakSet<WebContents>()
  handle('projects:orcaPreview', ({ manual }, { sender }) => {
    if (!manual && readAppSettings().orcaImport?.seen) return null
    const visible = visiblePreviews.get(sender)
    if (visible) return visible
    if (!observed.has(sender)) {
      observed.add(sender)
      sender.on('did-start-navigation', () => visiblePreviews.delete(sender))
    }

    // Plusieurs demandes peuvent arriver avant l'ouverture de la boîte. Elles affichent le même aperçu.
    const pending = preview()
    const clear = () => {
      if (visiblePreviews.get(sender) === pending) visiblePreviews.delete(sender)
    }
    void pending.then((source) => { if (!source) clear() }, clear)
    visiblePreviews.set(sender, pending)
    return pending
  })
  handle('projects:orcaDismiss', (_request, { sender }) => {
    visiblePreviews.delete(sender)
    saveOrcaImport()
    return null
  })
  handle('projects:orcaImport', async ({ repos, worktrees, useWorkspace }, { sender }) => {
    const visible = visiblePreviews.get(sender)
    const shown = useWorkspace ? (await visible)?.workspaceDir : undefined
    if (useWorkspace && !shown) throw new Error('Rouvrez l’aperçu Orca pour confirmer le dossier.')
    const source = await preview()
    if (!source) throw new Error('Aucun profil Orca détecté')
    const selectedWorktrees = new Set(worktrees)
    const chosen = source.worktrees.filter(({ path }) => selectedWorktrees.has(path))
    const requested = new Set([...repos, ...chosen.map(({ repoPath }) => repoPath)])
    const result: PickResult = { added: [], rejected: [] }
    const imported = new Set<string>()
    for (const repo of source.repos) {
      if (!requested.has(repo.path)) continue
      try {
        result.added.push(await addProject(db, repo.path))
        imported.add(repo.path)
      } catch (error) {
        result.rejected.push({ path: repo.path, reason: (error as Error).message })
      }
    }
    saveOrcaImport(shown ?? undefined)
    if (result.rejected.length === 0 && visiblePreviews.get(sender) === visible) visiblePreviews.delete(sender)
    return { ...result, activeWorktree: chosen.find(({ repoPath }) => imported.has(repoPath))?.path ?? null }
  })
}
