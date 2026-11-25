import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { TerminalLayout } from '../../../shared/ipc'

const livePane = 'shell-vivant'
const restoredPane = 'shell-à-relancer'
const layout: TerminalLayout = {
  activeTab: 'onglet',
  tabs: [
    {
      id: 'onglet',
      title: 'Terminal',
      cwd: '/tmp',
      activePane: restoredPane,
      tree: {
        type: 'split',
        dir: 'row',
        a: { type: 'pane', id: livePane },
        b: { type: 'pane', id: restoredPane },
      },
    },
  ],
}
const history = { data: 'historique précédent', cwd: '/tmp/projet', rows: 24, cols: 80 }

beforeEach(() => vi.resetModules())
afterEach(() => vi.unstubAllGlobals())

async function restoreWorkspace() {
  const invoke = vi.fn((channel: string) =>
    Promise.resolve(
      channel === 'terminal:workspace'
        ? { layout, livePanes: [livePane], historyPanes: [restoredPane] }
        : history,
    ),
  )
  vi.stubGlobal('window', { wu: { invoke } })
  const { restoreTerminalWorkspace, terminalStore } = await import('./terminal-store')
  await restoreTerminalWorkspace()
  return { terminalStore, invoke }
}

it('rattache le PTY vivant et charge l’historique du volet à relancer', async () => {
  const { terminalStore, invoke } = await restoreWorkspace()
  expect(terminalStore.activePane()).toBe(restoredPane)
  expect(terminalStore.isNew(livePane)).toBe(false)
  expect(terminalStore.isNew(restoredPane)).toBe(true)
  expect(terminalStore.history(restoredPane)).toEqual(history)
  expect(invoke).toHaveBeenLastCalledWith('terminal:loadHistory', { id: restoredPane })
})

it('enregistre la disposition et retire l’historique à la fermeture d’un volet', async () => {
  const { terminalStore, invoke } = await restoreWorkspace()
  terminalStore.closeActivePane()
  expect(terminalStore.history(restoredPane)).toBeUndefined()
  expect(terminalStore.isNew(restoredPane)).toBe(false)
  expect(invoke).not.toHaveBeenCalledWith('terminal:kill', { id: restoredPane })
  expect(invoke).toHaveBeenLastCalledWith('terminal:saveLayout', {
    ...layout,
    tabs: [{ ...layout.tabs[0], activePane: livePane, tree: { type: 'pane', id: livePane } }],
  })
  terminalStore.closeActivePane()
  expect(invoke).toHaveBeenCalledWith('terminal:kill', { id: livePane })
  expect(invoke).toHaveBeenLastCalledWith('terminal:saveLayout', { tabs: [], activeTab: null })
})

it('enregistre le volet actif uniquement quand la disposition change', async () => {
  const { terminalStore, invoke } = await restoreWorkspace()
  terminalStore.focusPane('onglet', restoredPane, true)
  expect(invoke).not.toHaveBeenCalledWith('terminal:saveLayout', expect.anything())
  expect(terminalStore.get().focusRequest).toBe(1)
  terminalStore.focusPane('onglet', livePane)
  expect(invoke).toHaveBeenLastCalledWith('terminal:saveLayout', {
    ...layout,
    tabs: [{ ...layout.tabs[0], activePane: livePane }],
  })
})
