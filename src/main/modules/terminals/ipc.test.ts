import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, app: {}, BrowserWindow: class {} }))
const { shellEnv } = await import('./ipc')

describe('shellEnv', () => {
  it("ne transmet pas au shell les variables propres à Electron", () => {
    const env = shellEnv({ PATH: '/bin', HOME: '/h', ELECTRON_RUN_AS_NODE: '1', ELECTRON_RENDERER_URL: 'x', CHROME_DESKTOP: 'y' })
    expect(env).toEqual({ PATH: '/bin', HOME: '/h', TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'workflow-ultimate' })
  })
})
