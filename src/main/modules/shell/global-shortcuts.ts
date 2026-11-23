import { execFile } from 'node:child_process'
import { app, globalShortcut } from 'electron'
import { runMainAction } from './single-instance'

const accelerator = 'Super+W'
const fallback = 'Repli : workflow-ultimate --action window.show'
type Status = { state: 'pending' | 'available' | 'unavailable' | 'not-wayland'; message: string }
let status: Status = { state: 'pending', message: 'Vérification du portail en cours.' }

export function globalShortcutStatus(): Status {
  return status
}

function portalAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      'gdbus',
      [
        'call',
        '--session',
        '--dest',
        'org.freedesktop.portal.Desktop',
        '--object-path',
        '/org/freedesktop/portal/desktop',
        '--method',
        'org.freedesktop.DBus.Properties.Get',
        'org.freedesktop.portal.GlobalShortcuts',
        'version',
      ],
      { timeout: 1500 },
      (error) => resolve(!error),
    )
  })
}

function unavailable(reason: string): void {
  status = { state: 'unavailable', message: `${reason} ${fallback}` }
  console.warn(status.message)
}

export async function registerGlobalShortcuts(): Promise<void> {
  const session = process.env['XDG_SESSION_TYPE']
  const ozone = app.commandLine.getSwitchValue('ozone-platform')
  const wayland =
    ozone === 'wayland' ||
    ((!ozone || ozone === 'auto') &&
      (session === 'wayland' || (!session && !!process.env['WAYLAND_DISPLAY'])))
  if (process.platform !== 'linux' || !wayland) {
    status = { state: 'not-wayland', message: `Portail réservé aux sessions Wayland. ${fallback}` }
    return
  }

  // Electron 45 active GlobalShortcutsPortal et PreferredTrigger avant ready par défaut.
  if (!(await portalAvailable())) {
    unavailable('Portail XDG GlobalShortcuts indisponible.')
    return
  }
  if (!globalShortcut.register(accelerator, () => runMainAction('window.toggle'))) {
    unavailable('Demande d’enregistrement de Meta+W refusée par Electron.')
    return
  }
  // L'API Electron ne renvoie pas la réponse asynchrone du portail.
  status = { state: 'available', message: `Portail disponible, demande Meta+W transmise. ${fallback}` }
  app.once('will-quit', () => globalShortcut.unregister(accelerator))
}
