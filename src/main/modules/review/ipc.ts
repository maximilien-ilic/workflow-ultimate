import type { DatabaseSync } from 'node:sqlite'
import type { AgentSessions } from '../agents/sessions'
import { getProject } from '../projects/registry'
import { listWorktrees } from '../projects/worktrees'
import { handle } from '../shell/ipc'
import { changedFiles, fileVersions, insideWorktree } from './changes'
import { commitChanges, pushBranch } from './commit'
import { createReviewComments } from './comments'
import { createPullRequest, readPullRequest } from './pull-request'

// Le renderer désigne un worktree ; on vérifie qu'il appartient bien à ce projet avant toute lecture.
async function checkedWorktree(db: DatabaseSync, projectId: string, worktreePath: string): Promise<string> {
  const worktrees = await listWorktrees(getProject(db, projectId).path)
  if (!worktrees.some((w) => w.path === worktreePath))
    throw new Error(`${worktreePath} n'est pas un worktree de ce projet`)
  return worktreePath
}

export function registerReviewHandlers(
  db: DatabaseSync, agents: AgentSessions, ownsLocalBranch: (projectId: string, branch: string) => boolean,
): void {
  const comments = createReviewComments(db)
  handle('review:comments', async (target) => {
    await checkedWorktree(db, target.projectId, target.worktreePath)
    return comments.list(target)
  })
  handle('review:addComment', async ({ projectId, worktreePath, path, line, side, body }) => {
    const target = { projectId, worktreePath: await checkedWorktree(db, projectId, worktreePath) }
    comments.add(target, { path: insideWorktree(target.worktreePath, path), line, side, body })
    return comments.list(target)
  })
  handle('review:sendComments', async ({ projectId, worktreePath, sessionId }, event) => {
    const target = { projectId, worktreePath: await checkedWorktree(db, projectId, worktreePath) }
    await comments.send(target, (message) => agents.writeReview(sessionId, target.worktreePath, event.sender, message))
    return comments.list(target)
  })
  handle('review:changes', async ({ projectId, worktreePath }) => {
    const { base, mergeBase, files } = await changedFiles(await checkedWorktree(db, projectId, worktreePath))
    return { base, mergeBase, files }
  })
  handle('review:comparison', async ({ projectId, worktreePath }) =>
    changedFiles(await checkedWorktree(db, projectId, worktreePath)),
  )
  handle('review:commit', async ({ projectId, worktreePath, message, paths }) => {
    const worktree = await checkedWorktree(db, projectId, worktreePath)
    return { sha: await commitChanges(worktree, message, paths?.map((path) => insideWorktree(worktree, path))) }
  })
  handle('review:push', async ({ projectId, worktreePath }) => ({
    output: await pushBranch(await checkedWorktree(db, projectId, worktreePath)),
  }))
  handle('review:pr', async ({ projectId, worktreePath }) =>
    readPullRequest(await checkedWorktree(db, projectId, worktreePath), (branch) => !ownsLocalBranch(projectId, branch)),
  )
  handle('review:createPr', async ({ projectId, worktreePath, branch, title, body }) =>
    createPullRequest(await checkedWorktree(db, projectId, worktreePath), branch, title, body),
  )
  handle('review:file', async ({ projectId, worktreePath, mergeBase, file }) =>
    fileVersions(await checkedWorktree(db, projectId, worktreePath), mergeBase, file),
  )
}
