import { BrowserWindow, dialog } from 'electron'
import type { DatabaseSync } from 'node:sqlite'
import type { PickResult } from '../../../shared/ipc'
import { handle } from '../shell/ipc'
import { readAppSettings } from '../shell/settings'
import { gitStatus } from './git-status'
import { registerOrcaImport } from './orca-import-ipc'
import { addProject, getProject, listProjects, removeProject, scanForRepos } from './registry'
import {
  issueBranch,
  createWorktree,
  defaultWorkspaces,
  DirtyWorktreeError,
  listWorktrees,
  removeWorktree,
} from './worktrees'

export const projectWorkspaces = () => readAppSettings().orcaImport?.workspaces ?? defaultWorkspaces()

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
  registerOrcaImport(db)
  handle('projects:list', () => listProjects(db))
  handle('projects:add', ({ path }) => addProject(db, path))
  handle('projects:remove', ({ id }) => {
    removeProject(db, id)
    return null
  })
  // Le renderer donne un id de projet, jamais un chemin de dépôt : le main le retrouve lui-même.
  const repoOf = (projectId: string) => getProject(db, projectId).path

  handle('worktrees:list', ({ projectId }) => listWorktrees(repoOf(projectId)))
  async function worktreeSnapshot(projectId: string) {
    const worktrees = await listWorktrees(repoOf(projectId))
    return Promise.all(
      worktrees.map(async (worktree) => ({
        ...worktree,
        status: await gitStatus(worktree.path).catch(() => null),
      })),
    )
  }

  handle('worktrees:snapshot', ({ projectId }) => worktreeSnapshot(projectId))
  handle('worktrees:status', async ({ projectId }) =>
    (await worktreeSnapshot(projectId)).map(({ path, status }) => ({ path, status })),
  )
  handle('worktrees:create', ({ projectId, branch, create }) =>
    createWorktree(repoOf(projectId), projectWorkspaces(), { branch, create }),
  )
  handle('worktrees:createFromIssue', async ({ projectId, issue }) => {
    const repo = repoOf(projectId)
    const branch = await issueBranch(repo, issue)
    return createWorktree(repo, projectWorkspaces(), { branch })
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
