import { app, dialog, shell } from 'electron'
import { join } from 'node:path'
import { dataDir, openDatabase } from './modules/shell/db'
import { buildDiagnosticsReport } from './modules/shell/diagnostics'
import { registerGlobalShortcuts } from './modules/shell/global-shortcuts'
import { handle } from './modules/shell/ipc'
import { installMainLogging } from './modules/shell/log'
import { migrations } from './modules/shell/migrations'
import { registerProjectHandlers } from './modules/projects/ipc'
import { registerTerminalHandlers } from './modules/terminals/ipc'
import { startPtyHost } from './modules/terminals/pty-host'
import { registerSettings } from './modules/shell/settings'
import { registerSingleInstance } from './modules/shell/single-instance'
import { createMainWindow } from './modules/shell/window'

if (!registerSingleInstance()) app.exit(0)

installMainLogging()
handle('diagnostics:report', buildDiagnosticsReport)

handle('app:info', () => ({
  name: app.getName(),
  version: app.getVersion(),
  electron: process.versions.electron,
  node: process.versions.node,
}))

// Le schéma n'accepte que http(s) : pas de file://, pas de schéma exotique lancé depuis un terminal.
handle('shell:openUrl', async ({ url }) => {
  await shell.openExternal(url)
  return null
})

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
  const ptyHost = startPtyHost()
  registerTerminalHandlers(ptyHost)
  app.on('will-quit', () => {
    ptyHost.stop()
    db.close()
  })
  createMainWindow()
})
void app.whenReady().then(registerGlobalShortcuts)
app.on('window-all-closed', () => app.quit())
