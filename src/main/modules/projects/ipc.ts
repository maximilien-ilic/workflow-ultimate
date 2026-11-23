import { BrowserWindow, dialog } from 'electron'
import type { DatabaseSync } from 'node:sqlite'
import type { PickResult } from '../../../shared/ipc'
import { handle } from '../shell/ipc'
import { addProject, listProjects, removeProject, scanForRepos } from './registry'

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
