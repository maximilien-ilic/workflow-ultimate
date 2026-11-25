import { app, BrowserWindow } from 'electron'

const actionId = /^[a-z0-9.-]+$/

export function parseAction(argv: readonly string[]): string | null {
  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--') break
    if (arg === '--action' || arg?.startsWith('--action=')) {
      const value = arg === '--action' ? argv[index + 1] : arg.slice('--action='.length)
      if (arg === '--action' && value?.startsWith('-')) return null
      return value && actionId.test(value) ? value : null
    }
  }
  return null
}

export function showMainWindow(window = BrowserWindow.getAllWindows()[0]): void {
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

function toggleMainWindow(): void {
  const window = BrowserWindow.getAllWindows()[0]
  if (!window) return
  if (window.isVisible() && !window.isMinimized()) window.hide()
  else showMainWindow()
}

const actions = new Map<string, () => void>([
  ['window.show', showMainWindow],
  ['window.toggle', toggleMainWindow],
])

export function runMainAction(id: string): void {
  const action = actions.get(id)
  if (action) action()
  else console.warn(`Action inconnue : ${id}`)
}

export function registerSingleInstance(): boolean {
  // Chromium peut réordonner les arguments transmis par second-instance.
  if (!app.requestSingleInstanceLock({ action: parseAction(process.argv) })) return false

  app.on('second-instance', (_event, _argv, _cwd, data) => {
    const id = data && typeof data === 'object' && 'action' in data ? data.action : null
    if (typeof id !== 'string' || !actionId.test(id)) {
      showMainWindow()
      return
    }

    runMainAction(id)
  })
  return true
}
