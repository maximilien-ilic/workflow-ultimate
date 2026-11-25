import { EventEmitter } from 'node:events'
import { beforeEach, expect, it, vi } from 'vitest'
import type { AgentSession } from '../../../shared/ipc'

const mocks = vi.hoisted(() => ({
  setImage: vi.fn(),
  showWindow: vi.fn(),
  send: vi.fn(),
  sound: vi.fn(() => true),
  notifications: vi.fn(),
}))
vi.mock('electron', () => ({
  Tray: class extends EventEmitter {
    setImage = mocks.setImage
    setToolTip() {}
    setContextMenu() {}
    destroy() {}
  },
  Menu: { buildFromTemplate: vi.fn() },
  Notification: class extends EventEmitter {
    static isSupported = () => true
    constructor(options: unknown) {
      super()
      mocks.notifications(options, this)
    }
    show() {
      this.emit('show')
    }
  },
  nativeImage: { createFromPath: (path: string) => ({ path, resize: () => path }) },
  app: { once: vi.fn() },
}))
vi.mock('./single-instance', () => ({ showMainWindow: mocks.showWindow }))
vi.mock('./settings', () => ({ notificationSound: mocks.sound, setNotificationSound: vi.fn() }))

const { registerAgentDesktop } = await import('./agent-desktop')
const session: AgentSession = {
  id: 'session',
  agent: 'claude-code',
  cwd: '/tmp/projet',
  terminalId: 'terminal',
  updatedAt: 0,
  state: 'waiting',
}
const window = (focused: boolean) =>
  ({
    isDestroyed: () => false,
    isFocused: () => focused,
    webContents: { send: mocks.send, isLoadingMainFrame: () => false },
  }) as never

beforeEach(() => {
  vi.clearAllMocks()
  mocks.sound.mockReturnValue(true)
})

it('garde le badge tant qu’au moins une session attend, même si la fenêtre a le focus', () => {
  const change = registerAgentDesktop(window(true))
  const second = { ...session, id: 'second' }
  change(session)
  change(second)
  change({ ...session, state: 'working' })
  expect(mocks.setImage).toHaveBeenCalledTimes(1)
  change({ ...second, state: 'done' })
  expect(mocks.setImage).toHaveBeenCalledTimes(2)
  expect(mocks.setImage.mock.calls[0]).not.toEqual(mocks.setImage.mock.calls[1])
  expect(mocks.notifications).not.toHaveBeenCalled()
})

it('notifie les attentes et les fins en arrière-plan et sélectionne le terminal au clic', () => {
  const mainWindow = window(false)
  const change = registerAgentDesktop(mainWindow)
  change({ ...session, state: 'working' })
  change(session)
  change({ ...session, state: 'done' })
  expect(mocks.notifications).toHaveBeenCalledTimes(2)
  expect(mocks.send.mock.calls).toEqual([
    ['agents:desktop', { type: 'play-sound' }],
    ['agents:desktop', { type: 'play-sound' }],
  ])
  const notification = mocks.notifications.mock.calls[1]?.[1] as EventEmitter
  notification.emit('click')
  expect(mocks.showWindow).toHaveBeenCalledWith(mainWindow)
  expect(mocks.send).toHaveBeenCalledWith('agents:desktop', { type: 'show-terminal', terminalId: 'terminal' })
})

it('conserve la notification visuelle quand le son est coupé', () => {
  mocks.sound.mockReturnValue(false)
  registerAgentDesktop(window(false))(session)
  expect(mocks.notifications).toHaveBeenCalledOnce()
  expect(mocks.send).not.toHaveBeenCalled()
})
