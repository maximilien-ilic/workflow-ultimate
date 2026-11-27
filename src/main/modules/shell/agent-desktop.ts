import { app, Menu, Notification, Tray, nativeImage, type BrowserWindow } from 'electron'
import { basename } from 'node:path'
import type { AgentDesktopEvent, AgentSession } from '../../../shared/ipc'
import appIconPath from '../../../../build/icons/512x512.png?asset'
import waitingIconPath from './tray-waiting.png?asset'
import { notificationSound, setNotificationSound } from './settings'
import { showMainWindow } from './single-instance'

const appTitle = 'Workflow Ultimate'
const notificationLabels = { waiting: 'attend une réponse', done: 'a terminé' }

function openAgent(window: BrowserWindow, terminalId: string): void {
  if (window.isDestroyed()) return
  showMainWindow(window)
  const contents = window.webContents
  const selectTerminal = () =>
    contents.send('agents:desktop', { type: 'show-terminal', terminalId } satisfies AgentDesktopEvent)
  if (contents.isLoadingMainFrame()) contents.once('did-finish-load', selectTerminal)
  else selectTerminal()
}

function notify(window: BrowserWindow, session: AgentSession, title: string, soundEnabled: () => boolean): void {
  const { terminalId } = session
  if (!terminalId || !Notification.isSupported()) return
  const notification = new Notification({
    title,
    body: basename(session.cwd).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    icon: appIconPath,
    silent: true,
  })
  notification.on('click', () => openAgent(window, terminalId))
  // Libnotify ne transmet pas l'option de son d'Electron. On joue le son depuis l'appli.
  if (soundEnabled()) {
    notification.once('show', () => {
      if (!window.isDestroyed())
        window.webContents.send('agents:desktop', { type: 'play-sound' } satisfies AgentDesktopEvent)
    })
  }
  notification.show()
}

export function registerAgentDesktop(window: BrowserWindow): (session: AgentSession) => void {
  const appIcon = nativeImage.createFromPath(appIconPath).resize({ width: 32, height: 32 })
  const waitingIcon = nativeImage.createFromPath(waitingIconPath)
  const tray = new Tray(appIcon)
  tray.setToolTip(appTitle)
  tray.on('click', () => showMainWindow(window))
  let sound = false
  function soundEnabled(): boolean {
    try {
      sound = notificationSound()
    } catch (error) {
      console.warn('Impossible de lire le réglage sonore des notifications :', error)
    }
    return sound
  }

  function updateMenu(): void {
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Afficher Workflow Ultimate', click: () => showMainWindow(window) },
      {
        label: 'Son des notifications',
        type: 'checkbox',
        checked: soundEnabled(),
        click: ({ checked }) => {
          try {
            setNotificationSound(checked)
            sound = checked
          } catch (error) {
            console.warn('Impossible d’enregistrer le réglage sonore des notifications :', error)
          }
          updateMenu()
        },
      },
    ]))
  }

  updateMenu()
  app.once('will-quit', () => tray.destroy())
  const waitingSessions = new Set<string>()

  return (session) => {
    const { id, state, agent } = session
    const wasWaiting = waitingSessions.size > 0
    if (state === 'waiting') waitingSessions.add(id)
    else waitingSessions.delete(id)
    const hasWaiting = waitingSessions.size > 0
    if (wasWaiting !== hasWaiting) tray.setImage(hasWaiting ? waitingIcon : appIcon)
    if (window.isDestroyed() || window.isFocused() || (state !== 'waiting' && state !== 'done')) return
    const name = agent === 'claude-code' ? 'Claude Code' : 'Codex'
    notify(window, session, `${name} ${notificationLabels[state]}`, soundEnabled)
  }
}
