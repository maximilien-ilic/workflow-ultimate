import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { handle } from './modules/shell/ipc'
import { registerSingleInstance } from './modules/shell/single-instance'

if (!registerSingleInstance()) app.exit(0)

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    title: 'Workflow Ultimate',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  win.once('ready-to-show', () => win.show())

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

handle('app:info', () => ({
  name: app.getName(),
  version: app.getVersion(),
  electron: process.versions.electron,
  node: process.versions.node,
}))

void app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
