import { BrowserWindow, dialog } from 'electron'
import type { DatabaseSync } from 'node:sqlite'
import type { PickResult } from '../../../shared/ipc'
import { handle } from '../shell/ipc'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { gitStatus } from './git-status'
import { addProject, getProject, listProjects, removeProject, scanForRepos } from './registry'
import {
  branchExists,
  branchForIssue,
  createWorktree,
  defaultWorkspaces,
  DirtyWorktreeError,
  listWorktrees,
  removeWorktree,
} from './worktrees'

const exec = promisify(execFile)

async function addAll(db: DatabaseSync, paths: string[]): Promise<PickResult> {
  const result: PickResult = { added: [], rejected: [] }
  for (const path of paths) {
    try {
      result.added.push(await addProject(db, path))
    } catch (error) {
      result.rejected.push({ path, reason: (error as Error).message })
    }
  }
  return result
}

export function registerProjectHandlers(db: DatabaseSync): void {
  handle('projects:list', () => listProjects(db))
  handle('projects:add', ({ path }) => addProject(db, path))
  handle('projects:remove', ({ id }) => {
    removeProject(db, id)
    return null
  })
  // Le renderer donne un id de projet, jamais un chemin de dépôt : le main le retrouve lui-même.
  const repoOf = (projectId: string) => getProject(db, projectId).path

  handle('worktrees:list', ({ projectId }) => listWorktrees(repoOf(projectId)))
  handle('worktrees:status', async ({ projectId }) => {
    const worktrees = await listWorktrees(repoOf(projectId))
    return Promise.all(
      worktrees.map(async ({ path }) => ({ path, status: await gitStatus(path).catch(() => null) })),
    )
  })
  handle('worktrees:create', ({ projectId, branch, create }) =>
    createWorktree(repoOf(projectId), defaultWorkspaces(), { branch, create }),
  )
  handle('worktrees:createFromIssue', async ({ projectId, issue }) => {
    const repo = repoOf(projectId)
    let title: string
    try {
      ;({ stdout: title } = await exec(
        'gh',
        ['issue', 'view', String(issue), '--json', 'title', '-q', '.title'],
        {
          cwd: repo,
          timeout: 15_000,
        },
      ))
    } catch (error) {
      throw new Error(`Ticket #${issue} introuvable avec gh : ${(error as Error).message}`, { cause: error })
    }
    const branch = branchForIssue(issue, title.trim())
    return createWorktree(repo, defaultWorkspaces(), { branch, create: !(await branchExists(repo, branch)) })
  })
  handle('worktrees:remove', async ({ projectId, path, force }) => {
    try {
      await removeWorktree(repoOf(projectId), path, { force })
      return { removed: true, dirtyFiles: 0 }
    } catch (error) {
      if (error instanceof DirtyWorktreeError) return { removed: false, dirtyFiles: error.files }
      throw error
    }
  })

  handle('projects:pick', async ({ mode }) => {
    const options: Electron.OpenDialogOptions = {
      title: mode === 'repo' ? 'Ajouter des dépôts' : 'Scanner un dossier de projets',
      properties: mode === 'repo' ? ['openDirectory', 'multiSelections'] : ['openDirectory'],
    }
    const parent = BrowserWindow.getFocusedWindow()
    const { canceled, filePaths } = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options)
    if (canceled || filePaths.length === 0) return { added: [], rejected: [] }
    if (mode === 'repo') return addAll(db, filePaths)
    const [root = ''] = filePaths
    return addAll(db, await scanForRepos(root))
  })
}
