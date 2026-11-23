import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, app: {}, BrowserWindow: class {} }))
const { shellEnv } = await import('./ipc')

describe('shellEnv', () => {
  it('ne transmet pas au shell les variables propres à Electron', () => {
    const env = shellEnv({
      PATH: '/bin',
      HOME: '/h',
      ELECTRON_RUN_AS_NODE: '1',
      ELECTRON_RENDERER_URL: 'x',
      GIT_DIR: '/autre/.git',
      GIT_WORK_TREE: '/autre',
      GIT_CONFIG_PARAMETERS: "'core.hooksPath'='/tmp/x'",
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.pager',
      GIT_CONFIG_VALUE_0: 'evil',
      GIT_EDITOR: 'vim',
      CHROME_DESKTOP: 'y',
    })
    expect(env).toEqual({
      PATH: '/bin',
      HOME: '/h',
      GIT_EDITOR: 'vim',
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'workflow-ultimate',
    })
  })
})
