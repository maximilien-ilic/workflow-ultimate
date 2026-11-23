import { app } from 'electron'
import { buildDiagnosticsReport } from './modules/shell/diagnostics'
import { registerGlobalShortcuts } from './modules/shell/global-shortcuts'
import { handle } from './modules/shell/ipc'
import { installMainLogging } from './modules/shell/log'
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

registerSettings()
void app.whenReady().then(createMainWindow)
void app.whenReady().then(registerGlobalShortcuts)
app.on('window-all-closed', () => app.quit())
