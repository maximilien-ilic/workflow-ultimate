import type { DatabaseSync } from 'node:sqlite'
import { getProject } from '../projects/registry'
import { listWorktrees } from '../projects/worktrees'
import { handle } from '../shell/ipc'
import { changedFiles, fileVersions, insideWorktree } from './changes'
import { commitChanges, pushBranch } from './commit'

// Le renderer désigne un worktree ; on vérifie qu'il appartient bien à ce projet avant toute lecture.
async function checkedWorktree(db: DatabaseSync, projectId: string, worktreePath: string): Promise<string> {
  const worktrees = await listWorktrees(getProject(db, projectId).path)
  if (!worktrees.some((w) => w.path === worktreePath))
    throw new Error(`${worktreePath} n'est pas un worktree de ce projet`)
  return worktreePath
}

export function registerReviewHandlers(db: DatabaseSync): void {
  handle('review:changes', async ({ projectId, worktreePath }) =>
    changedFiles(await checkedWorktree(db, projectId, worktreePath)),
  )
  handle('review:commit', async ({ projectId, worktreePath, message, paths }) => {
    const worktree = await checkedWorktree(db, projectId, worktreePath)
    paths?.forEach((path) => insideWorktree(worktree, path))
    return { sha: await commitChanges(worktree, message, paths) }
  })
  handle('review:push', async ({ projectId, worktreePath }) => ({
    output: await pushBranch(await checkedWorktree(db, projectId, worktreePath)),
  }))
  handle('review:file', async ({ projectId, worktreePath, mergeBase, file }) =>
    fileVersions(await checkedWorktree(db, projectId, worktreePath), mergeBase, file),
  )
}
