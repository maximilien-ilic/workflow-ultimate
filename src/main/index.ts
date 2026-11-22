import { app } from 'electron'
import { handle } from './modules/shell/ipc'
import { createMainWindow } from './modules/shell/window'

handle('app:info', () => ({
  name: app.getName(),
  version: app.getVersion(),
  electron: process.versions.electron,
  node: process.versions.node,
}))

void app.whenReady().then(createMainWindow)
app.on('window-all-closed', () => app.quit())
