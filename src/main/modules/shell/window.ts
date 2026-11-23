import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

// L'URL du serveur Vite n'est acceptée que hors build packagé et seulement en http local :
// une variable héritée ne doit jamais pouvoir charger une page distante avec notre preload.
export function devRendererUrl(env: NodeJS.ProcessEnv, isPackaged: boolean): string | undefined {
  const raw = env['ELECTRON_RENDERER_URL']
  if (isPackaged || !raw || !URL.canParse(raw)) return undefined
  const url = new URL(raw)
  return url.protocol === 'http:' && LOOPBACK.has(url.hostname) ? url.href : undefined
}

export function rendererUrl(): string {
  return (
    devRendererUrl(process.env, app.isPackaged) ?? pathToFileURL(join(__dirname, '../renderer/index.html')).href
  )
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

  // Toute nouvelle fenêtre est refusée ; les liens des terminaux passent par shell:openUrl (http/https)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const withoutHash = (u: string) => u.split('#')[0]
  const stayOnRenderer = (event: Electron.Event, target: string) => {
    if (withoutHash(target) !== withoutHash(url)) event.preventDefault()
  }
  win.webContents.on('will-navigate', stayOnRenderer)
  win.webContents.on('will-redirect', stayOnRenderer)

  void win.loadURL(url)
  return win
}
