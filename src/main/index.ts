import { app } from 'electron'
import { registerGlobalShortcuts } from './modules/shell/global-shortcuts'
import { handle } from './modules/shell/ipc'
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
void app.whenReady().then(createMainWindow)
void app.whenReady().then(registerGlobalShortcuts)
app.on('window-all-closed', () => app.quit())
