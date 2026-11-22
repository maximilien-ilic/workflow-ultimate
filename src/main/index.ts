import { app, dialog } from 'electron'
import { join } from 'node:path'
import { dataDir, openDatabase } from './modules/shell/db'
import { handle } from './modules/shell/ipc'
import { migrations } from './modules/shell/migrations'
import { registerProjectHandlers } from './modules/projects/ipc'
import { registerSettings } from './modules/shell/settings'
import { registerSingleInstance } from './modules/shell/single-instance'
import { createMainWindow } from './modules/shell/window'

if (!registerSingleInstance()) app.exit(0)

handle('app:info', () => ({
  name: app.getName(),
  version: app.getVersion(),
  electron: process.versions.electron,
  node: process.versions.node,
}))

registerSettings()
void app.whenReady().then(() => {
  let db
  try {
    db = openDatabase(join(dataDir(), 'app.db'), migrations)
  } catch (error) {
    // Ne jamais démarrer sur une base à moitié migrée : on s'arrête et on dit pourquoi.
    dialog.showErrorBox('Workflow Ultimate : base de données', (error as Error).message)
    app.exit(1)
    return
  }
  registerProjectHandlers(db)
  app.on('will-quit', () => db.close())
  createMainWindow()
})
app.on('window-all-closed', () => app.quit())
