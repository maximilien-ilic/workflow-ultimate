import { execFile, type ExecException } from 'node:child_process'
import { app, BrowserWindow, globalShortcut } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { globalShortcutStatus, registerGlobalShortcuts } from './global-shortcuts'

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
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

const portalResponse = (error: ExecException | null) => {
  vi.mocked(execFile).mockImplementationOnce((...args) => {
    const callback = args.at(-1)
    if (typeof callback === 'function') callback(error, '(<uint32 2>,)', '')
    return {} as ReturnType<typeof execFile>
  })
}

describe('raccourci global', () => {
  it('utilise Super+W pour masquer, afficher ou restaurer la fenêtre', async () => {
    portalResponse(null)
    vi.mocked(globalShortcut.register).mockReturnValue(true)
    const window = {
      isVisible: vi.fn().mockReturnValue(true),
      isFocused: vi.fn().mockReturnValue(true),
      isMinimized: vi.fn().mockReturnValue(false),
      hide: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      restore: vi.fn(),
    }
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([window as unknown as BrowserWindow])
    await registerGlobalShortcuts()

    expect(globalShortcutStatus().state).toBe('available')
    expect(globalShortcut.register).toHaveBeenCalledExactlyOnceWith('Super+W', expect.any(Function))
    const toggle = vi.mocked(globalShortcut.register).mock.calls[0]![1]
    toggle()
    expect(window.hide).toHaveBeenCalledOnce()
    expect(window.show).not.toHaveBeenCalled()

    window.isFocused.mockReturnValue(false)
    toggle()
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()

    window.isMinimized.mockReturnValue(true)
    window.isVisible.mockReturnValue(false)
    toggle()
    expect(window.restore).toHaveBeenCalledOnce()

    expect(app.once).toHaveBeenCalledExactlyOnceWith('will-quit', expect.any(Function))
    const unregister = vi.mocked(app.once).mock.calls[0]![1]
    unregister()
    expect(globalShortcut.unregister).toHaveBeenCalledExactlyOnceWith('Super+W')
  })

  it('consigne le repli quand le portail est inaccessible', async () => {
    portalResponse(Object.assign(new Error('No such interface'), { cmd: 'gdbus' }))
    await registerGlobalShortcuts()
    expect(globalShortcut.register).not.toHaveBeenCalled()
    expect(globalShortcutStatus().state).toBe('unavailable')
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('--action window.show'))
  })

  it('consigne le repli quand Electron refuse la demande', async () => {
    portalResponse(null)
    vi.mocked(globalShortcut.register).mockReturnValue(false)
    await registerGlobalShortcuts()
    expect(globalShortcutStatus().state).toBe('unavailable')
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('--action window.show'))
  })

  it('laisse les raccourcis X11 au système', async () => {
    vi.stubEnv('XDG_SESSION_TYPE', 'x11')
    await registerGlobalShortcuts()
    expect(execFile).not.toHaveBeenCalled()
    expect(globalShortcut.register).not.toHaveBeenCalled()
    expect(globalShortcutStatus().state).toBe('not-wayland')
  })
})
