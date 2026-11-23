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

export function useWorkspace() {
  const [groups, setGroups] = useState<ProjectGroup[]>([])
  const [path, select] = useState<string>()
  const [error, setError] = useState('')
  const revision = useRef(0)
  const invalidate = useCallback(() => {
    revision.current++
  }, [])

  const refresh = useCallback(async () => {
    const request = ++revision.current
    try {
      const projects = await window.wu.invoke('projects:list', {})
      const next = await Promise.all(
        projects.map(async (project): Promise<ProjectGroup> => {
          try {
            const [worktrees, statuses] = await Promise.all([
              window.wu.invoke('worktrees:list', { projectId: project.id }),
              window.wu.invoke('worktrees:status', { projectId: project.id }),
            ])
            const byPath = new Map(statuses.map(({ path, status }) => [path, status]))
            return {
              project,
              worktrees: worktrees.map((worktree) => ({
                ...worktree,
                status: byPath.get(worktree.path) ?? null,
              })),
            }
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
    }
  }, [])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const onFocus = () => {
      clearTimeout(timer)
      timer = setTimeout(() => void refresh(), 200)
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
  const selected = targets.find(({ worktree }) => worktree.path === path) ?? targets[0]
  return { groups, selected, select, refresh, error }
}

export type Workspace = ReturnType<typeof useWorkspace>
