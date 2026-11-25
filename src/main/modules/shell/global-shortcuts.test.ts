import { execFile, type ExecException } from 'node:child_process'
import { app, BrowserWindow, globalShortcut } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { showQuickLaunch } from './quick-launch'
import { globalShortcutStatus, registerGlobalShortcuts } from './global-shortcuts'

vi.mock('./quick-launch', () => ({ isQuickLaunchWindow: () => false, showQuickLaunch: vi.fn() }))
vi.mock('node:child_process', () => ({ execFile: vi.fn() }))
vi.mock('electron', () => ({
  app: { commandLine: { getSwitchValue: vi.fn() }, once: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn() },
  globalShortcut: { register: vi.fn(), unregister: vi.fn() },
}))

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('XDG_SESSION_TYPE', 'wayland')
  vi.stubEnv('WAYLAND_DISPLAY', 'wayland-0')
  vi.stubEnv('XDG_CURRENT_DESKTOP', 'KDE')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

const portalResponse = (error: ExecException | null, stdout = '(<uint32 2>,)') => {
  vi.mocked(execFile).mockImplementationOnce((...args) => {
    const callback = args.at(-1)
    if (typeof callback === 'function') callback(error, stdout, '')
    return {} as ReturnType<typeof execFile>
  })
}

describe('raccourci global', () => {
  it('utilise Super+Shift+W pour masquer, afficher ou restaurer la fenêtre', async () => {
    portalResponse(null)
    vi.mocked(globalShortcut.register).mockReturnValue(true)
    const window = {
      isVisible: vi.fn().mockReturnValue(true),
      isFocused: vi.fn().mockReturnValue(false),
      isMinimized: vi.fn().mockReturnValue(false),
      hide: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      restore: vi.fn(),
    }
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([window as unknown as BrowserWindow])
    await registerGlobalShortcuts()

    portalResponse(
      null,
      "([('shortcut', 'Workflow Ultimate', 'io.github.maximilien-ilic.workflow-ultimate', 'Workflow Ultimate', 'default', 'Default Context', [301989975], [301989975])],)",
    )
    expect((await globalShortcutStatus()).message).toContain('Meta+Shift+W attribué à Workflow Ultimate')
    portalResponse(null, '(@a(ssssssaiai) [],)')
    expect((await globalShortcutStatus()).message).toContain('Meta+Shift+W non attribué à Workflow Ultimate')
    expect(globalShortcut.register).toHaveBeenCalledWith('Super+Shift+W', expect.any(Function))
    const toggle = vi.mocked(globalShortcut.register).mock.calls[0]![1]
    toggle()
    expect(window.hide).toHaveBeenCalledOnce()
    expect(window.show).not.toHaveBeenCalled()

    window.isVisible.mockReturnValue(false)
    toggle()
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()

    window.isMinimized.mockReturnValue(true)
    window.isVisible.mockReturnValue(false)
    toggle()
    expect(window.restore).toHaveBeenCalledOnce()

    expect(app.once).toHaveBeenCalledWith('will-quit', expect.any(Function))
    const unregister = vi.mocked(app.once).mock.calls[0]![1]
    unregister()
    expect(globalShortcut.unregister).toHaveBeenCalledExactlyOnceWith('Super+Shift+W')
  })

  it('ouvre le lanceur avec Super+Shift+N même si Super+Shift+W est refusé', async () => {
    portalResponse(null)
    vi.mocked(globalShortcut.register).mockReturnValueOnce(false).mockReturnValueOnce(true)
    const window = {} as BrowserWindow
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([window])
    await registerGlobalShortcuts()

    expect(globalShortcut.register).toHaveBeenCalledWith('Super+Shift+N', expect.any(Function))
    const open = vi.mocked(globalShortcut.register).mock.calls[1]![1]
    open()
    expect(showQuickLaunch).toHaveBeenCalledExactlyOnceWith(window)

    const unregister = vi.mocked(app.once).mock.calls[0]![1]
    unregister()
    expect(globalShortcut.unregister).toHaveBeenCalledExactlyOnceWith('Super+Shift+N')
  })

  it('consigne le repli quand le portail est inaccessible', async () => {
    portalResponse(Object.assign(new Error('No such interface'), { cmd: 'gdbus' }))
    await registerGlobalShortcuts()
    expect(globalShortcut.register).not.toHaveBeenCalled()
    expect((await globalShortcutStatus()).state).toBe('unavailable')
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('--action window.show'))
  })

  it('consigne le repli quand Electron refuse la demande', async () => {
    portalResponse(null)
    vi.mocked(globalShortcut.register).mockReturnValue(false)
    await registerGlobalShortcuts()
    expect((await globalShortcutStatus()).state).toBe('unavailable')
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('--action window.show'))
  })

  it('laisse les raccourcis X11 au système', async () => {
    vi.stubEnv('XDG_SESSION_TYPE', 'x11')
    await registerGlobalShortcuts()
    expect(execFile).not.toHaveBeenCalled()
    expect(globalShortcut.register).not.toHaveBeenCalled()
    expect((await globalShortcutStatus()).state).toBe('not-wayland')
  })
})
