import type { BrowserWindow, WebContents } from 'electron'
import type { QuickAgentStarted } from '../../../shared/ipc'
import { createRendererWindow } from './window'

const launchWindowSize = { width: 460, height: 320 }
let launcher: BrowserWindow | undefined

export function isQuickLaunchWindow(window: BrowserWindow): boolean {
  return window === launcher
}

export function quickLaunchWindowFor(sender: WebContents): BrowserWindow | undefined {
  if (launcher?.webContents === sender) return launcher
}

export function showQuickLaunch(parent: BrowserWindow): void {
  if (launcher) {
    launcher.focus()
    return
  }

  const window = createRendererWindow(
    { ...launchWindowSize, parent, title: 'Lancement rapide', resizable: false, autoHideMenuBar: true },
    'quick-launch',
  )
  launcher = window
  window.once('closed', () => {
    launcher = undefined
  })
  window.once('ready-to-show', () => window.show())
}

export function finishQuickLaunch(
  window: BrowserWindow,
  parent: BrowserWindow,
  session: QuickAgentStarted,
): void {
  // La fermeture n'est plus un abandon une fois l'agent attaché à la fenêtre principale.
  if (!window.isDestroyed()) window.destroy()
  if (parent.isDestroyed()) return
  const contents = parent.webContents
  const attach = () => contents.send('agents:quickStarted', session)
  if (contents.isLoadingMainFrame()) contents.once('did-finish-load', attach)
  else attach()
}
