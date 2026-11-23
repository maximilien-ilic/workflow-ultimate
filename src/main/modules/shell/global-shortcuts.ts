import { execFile } from 'node:child_process'
import { app, globalShortcut } from 'electron'
import { runMainAction } from './single-instance'

const accelerator = 'Super+Shift+W'
const shortcutLabel = 'Meta+Shift+W'
const plasmaKey = 0x10000000 | 0x02000000 | 0x57 // Qt::META | Qt::SHIFT | Qt::Key_W
const portalAppId = 'io.github.maximilien-ilic.workflow-ultimate' // desktopName dans package.json
const fallback = 'Repli : workflow-ultimate --action window.show'
type Status = { state: 'pending' | 'available' | 'unavailable' | 'not-wayland'; message: string }
let status: Status = { state: 'pending', message: 'Vérification du portail en cours.' }

export async function globalShortcutStatus(): Promise<Status> {
  const initial = status
  if (initial.state !== 'available' || !process.env['XDG_CURRENT_DESKTOP']?.split(':').includes('KDE')) {
    return initial
  }
  // En Wayland, register() confirme seulement l'envoi de la demande. KDE possède l'affectation réelle.
  const assigned = await dbusCall(
    'org.kde.kglobalaccel',
    '/kglobalaccel',
    'org.kde.KGlobalAccel.globalShortcutsByKey',
    `([int32 ${plasmaKey}],)`,
    '(0,)',
  )
  if (!assigned) return initial
  const result = assigned.includes(`, '${portalAppId}',`) ? 'attribué' : 'non attribué'
  return { ...initial, message: `KDE : ${shortcutLabel} ${result} à Workflow Ultimate. ${fallback}` }
}

function dbusCall(
  service: string,
  path: string,
  method: string,
  ...args: string[]
): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      'gdbus',
      ['call', '--session', '--dest', service, '--object-path', path, '--method', method, ...args],
      { timeout: 1500 },
      (error, stdout) => resolve(error ? undefined : stdout),
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
  if (
    !(await dbusCall(
      'org.freedesktop.portal.Desktop',
      '/org/freedesktop/portal/desktop',
      'org.freedesktop.DBus.Properties.Get',
      'org.freedesktop.portal.GlobalShortcuts',
      'version',
    ))
  ) {
    unavailable('Portail XDG GlobalShortcuts indisponible.')
    return
  }
  if (!globalShortcut.register(accelerator, () => runMainAction('window.toggle'))) {
    unavailable(`Demande d’enregistrement de ${shortcutLabel} refusée par Electron.`)
    return
  }
  // L'API Electron ne renvoie pas la réponse asynchrone du portail.
  status = {
    state: 'available',
    message: `Portail disponible, demande ${shortcutLabel} transmise. ${fallback}`,
  }
  app.once('will-quit', () => globalShortcut.unregister(accelerator))
}
