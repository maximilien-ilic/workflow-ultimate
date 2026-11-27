import { useCallback, useEffect, useRef, useState } from 'react'
import type { GitStatus, Project, Worktree } from '../../../shared/ipc'

export type WorktreeSummary = Worktree & { status: GitStatus | null }
export type ProjectGroup = { project: Project; worktrees: WorktreeSummary[]; error?: string }
export type WorktreeSelection = { project: Project; worktree: WorktreeSummary }

export function worktreeLabel(worktree: WorktreeSummary): string {
  return (
    worktree.status?.branch ??
    worktree.branch ??
    (worktree.status?.shortSha ? `HEAD ${worktree.status.shortSha}` : 'HEAD détachée')
  )
}

const recentKey = 'wu.workspace-recents'
const worktreePrefix = 'worktree:'
const projectPrefix = 'project:'
const statusIntervalMs = 2_000

function recentWorktree(groups: ProjectGroup[], key = ''): string | undefined {
  if (key.startsWith(worktreePrefix)) return key.slice(worktreePrefix.length)
  if (!key.startsWith(projectPrefix)) return undefined
  const group = groups.find(({ project }) => project.id === key.slice(projectPrefix.length))
  return (group?.worktrees.find(({ main }) => main) ?? group?.worktrees[0])?.path
}

function readRecent(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(recentKey) ?? '[]')
    if (Array.isArray(stored))
      return stored.filter((key): key is string => typeof key === 'string').slice(0, 100)
  } catch {
    // Un profil sans stockage local reste utilisable.
  }
  return []
}

export function useWorkspace({ followSelection = false } = {}) {
  const [groups, setGroups] = useState<ProjectGroup[]>([])
  const [path, setPath] = useState<string>()
  const [recent, setRecent] = useState(readRecent)
  const [collapsed, setCollapsed] = useState(new Set<string>())
  const [error, setError] = useState('')
  const select = useCallback((path: string, key = `worktree:${path}`) => {
    setPath(path)
    setRecent((previous) => [key, ...previous.filter((entry) => entry !== key)].slice(0, 100))
  }, [])

  useEffect(() => {
    if (followSelection) return
    try {
      localStorage.setItem(recentKey, JSON.stringify(recent))
    } catch {
      // Le classement reste accessible tant que la fenêtre est ouverte.
    }
  }, [followSelection, recent])

  useEffect(() => {
    if (!followSelection) return
    const sync = () => setRecent(readRecent())
    const onStorage = (event: StorageEvent) => {
      if (event.key === recentKey || event.key === null) sync()
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener('focus', sync)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('focus', sync)
    }
  }, [followSelection])

  function expand(id: string, expanded: boolean) {
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (expanded) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const revision = useRef(0)
  const refreshing = useRef(0)
  const invalidate = useCallback(() => {
    revision.current++
  }, [])

  const refresh = useCallback(async () => {
    const request = ++revision.current
    refreshing.current++
    try {
      const projects = await window.wu.invoke('projects:list', {})
      const next = await Promise.all(
        projects.map(async (project): Promise<ProjectGroup> => {
          try {
            const worktrees = await window.wu.invoke('worktrees:snapshot', { projectId: project.id })
            return { project, worktrees }
          } catch (error) {
            return { project, worktrees: [], error: String(error) }
          }
        }),
      )
      if (request === revision.current) {
        setGroups(next)
        setError('')
      }
    } catch (error) {
      if (request === revision.current) setError(String(error))
    } finally {
      refreshing.current--
    }
  }, [])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const onFocus = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (refreshing.current === 0) void refresh()
      }, 200)
    }
    onFocus()
    window.addEventListener('focus', onFocus)
    return () => {
      invalidate()
      clearTimeout(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [invalidate, refresh])

  const targets = groups.flatMap(({ project, worktrees }) =>
    worktrees.map((worktree) => ({ project, worktree })),
  )
  const activePath = path ?? recentWorktree(groups, recent[0])
  const selected = targets.find(({ worktree }) => worktree.path === activePath) ?? targets[0]
  const projectId = selected?.project.id
  const polling = useRef(false)
  useEffect(() => {
    if (!projectId) return
    let cancelled = false

    async function poll(projectId: string) {
      if (document.hidden || polling.current || refreshing.current > 0) return
      polling.current = true
      const request = revision.current
      try {
        const worktrees = await window.wu.invoke('worktrees:snapshot', { projectId })
        if (cancelled || request !== revision.current) return
        setGroups((previous) =>
          previous.map((group) =>
            group.project.id === projectId
              ? {
                  ...group,
                  worktrees: worktrees.map((worktree) => ({
                    ...worktree,
                    branch: worktree.status ? worktree.status.branch : worktree.branch,
                  })),
                }
              : group,
          ),
        )
      } catch {
        // Un échec transitoire laisse le dernier état affiché jusqu'au prochain passage.
      } finally {
        polling.current = false
      }
    }

    const timer = window.setInterval(() => void poll(projectId), statusIntervalMs)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [projectId])

  return { groups, selected, select, refresh, error, recent, collapsed, expand }
}

export type Workspace = ReturnType<typeof useWorkspace>
