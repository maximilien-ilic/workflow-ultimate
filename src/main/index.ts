import { app, dialog, shell } from 'electron'
import { join } from 'node:path'
import { dataDir, openDatabase } from './modules/shell/db'
import { buildDiagnosticsReport } from './modules/shell/diagnostics'
import { registerGlobalShortcuts } from './modules/shell/global-shortcuts'
import { handle } from './modules/shell/ipc'
import { installMainLogging } from './modules/shell/log'
import { migrations } from './modules/shell/migrations'
import { registerAgentHandlers } from './modules/agents/sessions'
import { profileSocketPath } from './modules/agents/profile-socket'
import { startAgentSocket } from './modules/agents/socket'
import { registerProjectHandlers } from './modules/projects/ipc'
import { registerReviewHandlers } from './modules/review/ipc'
import { registerTerminalHandlers } from './modules/terminals/ipc'
import { startPtyHost } from './modules/terminals/pty-host'
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

// Le schéma n'accepte que http(s) : pas de file://, pas de schéma exotique lancé depuis un terminal.
handle('shell:openUrl', async ({ url }) => {
  await shell.openExternal(url)
  return null
})

registerSettings()
void app.whenReady().then(async () => {
  let db
  try {
    db = openDatabase(join(dataDir(), 'app.db'), migrations)
  } catch (error) {
    // Ne jamais démarrer sur une base à moitié migrée : on s'arrête et on dit pourquoi.
    dialog.showErrorBox('Workflow Ultimate : base de données', (error as Error).message)
    app.exit(1)
    return
  }
  registerProjectHandlers(db)
  registerReviewHandlers(db)
  const ptyHost = startPtyHost()
  const terminals = registerTerminalHandlers(ptyHost)

  // Agents : les hooks appellent wu-notify avec le Node embarqué (ELECTRON_RUN_AS_NODE) ; il écrit sur le socket.
  // Toute erreur de socket (EACCES sur XDG_RUNTIME_DIR, chemin occupé…) est isolée : la fenêtre s'ouvre,
  // les agents tournent, seul leur état ne se met plus à jour.
  const socketPath = await profileSocketPath().catch((error: unknown) => {
    console.error(`Chemin du socket des agents indisponible : ${String(error)}`)
    return null
  })
  const agents = registerAgentHandlers(db, terminals, {
    notify: {
      node: process.execPath,
      script: app.isPackaged
        ? join(process.resourcesPath, 'wu-notify')
        : join(__dirname, '../../resources/wu-notify'),
    },
    socketPath: socketPath ?? '',
    bins: {
      'claude-code': process.env['WU_CLAUDE_BIN'] || 'claude',
      codex: process.env['WU_CODEX_BIN'] || 'codex',
    },
  })
  const socket = socketPath
    ? await startAgentSocket({
        path: socketPath,
        sessionAgent: agents.sessionAgent,
        onEvent: agents.onSocketEvent,
      }).catch((error: unknown) => console.error(`Socket des agents indisponible : ${String(error)}`))
    : undefined

  app.on('will-quit', () => {
    void socket?.close()
    ptyHost.stop()
    db.close()
  })
  createMainWindow()
})
void app.whenReady().then(registerGlobalShortcuts)
app.on('window-all-closed', () => app.quit())
