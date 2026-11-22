import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// L'URL du serveur de dev n'est acceptée que hors build packagé : une variable héritée
// ne doit jamais pouvoir charger une page arbitraire avec notre preload.
export function rendererUrl(): string {
  const devUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL']
  return devUrl ?? pathToFileURL(join(__dirname, '../renderer/index.html')).href
}

export function createMainWindow(): BrowserWindow {
  const url = rendererUrl()
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

  // shortcut: tout lien externe est bloqué ; ouvrir via shell.openExternal quand le module browser arrivera
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const withoutHash = (u: string) => u.split('#')[0]
  win.webContents.on('will-navigate', (event, target) => {
    if (withoutHash(target) !== withoutHash(url)) event.preventDefault()
  })

  void win.loadURL(url)
  return win
}
