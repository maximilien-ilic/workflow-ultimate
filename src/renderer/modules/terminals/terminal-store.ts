import { closePane, paneIds, splitPane } from './pane-tree'
import type { TerminalHistory, TerminalLayout } from '../../../shared/ipc'

export type Tab = TerminalLayout['tabs'][number]
type State = TerminalLayout & { created: Set<string>; focusRequest: number }

let state: State = { tabs: [], activeTab: null, created: new Set(), focusRequest: 0 }
const listeners = new Set<() => void>()
const restored = new Map<string, TerminalHistory>()

function set(next: TerminalLayout, requestFocus = false) {
  const changed = next.tabs !== state.tabs || next.activeTab !== state.activeTab
  if (!changed && !requestFocus) return
  state = { ...next, created: state.created, focusRequest: state.focusRequest + Number(requestFocus) }
  if (changed) void window.wu.invoke('terminal:saveLayout', next).catch(console.error)
  listeners.forEach((l) => l())
}

export async function restoreTerminalWorkspace() {
  try {
    const { layout, livePanes, historyPanes } = await window.wu.invoke('terminal:workspace', {})
    const live = new Set(livePanes)
    const created = new Set(layout.tabs.flatMap((tab) => paneIds(tab.tree)).filter((id) => !live.has(id)))
    state = { ...layout, created, focusRequest: 0 }
    await Promise.all(
      historyPanes.map(async (id) => {
        const history = await window.wu.invoke('terminal:loadHistory', { id })
        if (history) restored.set(id, history)
      }),
    )
  } catch (error) {
    console.error('Restauration des terminaux impossible', error)
  }
}

const activeTabOf = () => state.tabs.find((t) => t.id === state.activeTab)

export const terminalStore = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  get: () => state,
  history: (id: string) => restored.get(id),
  // Un volet pas encore lancé doit créer son PTY ; tout autre (restauré, ou remonté après un split) s'y rattache.
  isNew: (paneId: string) => state.created.has(paneId),
  markStarted: (paneId: string) => void state.created.delete(paneId),

  openTab(cwd: string, title: string) {
    const pane = crypto.randomUUID()
    state.created.add(pane)
    const tab: Tab = {
      id: crypto.randomUUID(),
      title,
      cwd,
      tree: { type: 'pane', id: pane },
      activePane: pane,
    }
    set({ tabs: [...state.tabs, tab], activeTab: tab.id })
  },
  // Onglet sur un terminal déjà lancé par le main (agent) : le volet s'y rattache au lieu d'en créer un.
  openAttachedTab(cwd: string, title: string, paneId: string) {
    const tab: Tab = {
      id: crypto.randomUUID(),
      title,
      cwd,
      tree: { type: 'pane', id: paneId },
      activePane: paneId,
    }
    set({ tabs: [...state.tabs, tab], activeTab: tab.id })
  },
  split(dir: 'row' | 'column') {
    const tab = activeTabOf()
    if (!tab) return
    const pane = crypto.randomUUID()
    state.created.add(pane)
    const updated = { ...tab, tree: splitPane(tab.tree, tab.activePane, dir, pane), activePane: pane }
    set({ tabs: state.tabs.map((t) => (t.id === tab.id ? updated : t)), activeTab: tab.id })
  },
  focusPane(tabId: string, paneId: string, requestFocus = false) {
    if (!requestFocus && state.activeTab !== tabId) return
    const tab = state.tabs.find((item) => item.id === tabId)
    if (!tab) return
    set(
      {
        tabs:
          tab.activePane === paneId
            ? state.tabs
            : state.tabs.map((t) => (t === tab ? { ...t, activePane: paneId } : t)),
        activeTab: tabId,
      },
      requestFocus,
    )
  },
  // Affiche l'onglet qui contient ce volet et le rend actif (vue d'ensemble, agent suivant en attente).
  showPane(paneId: string) {
    const tab = state.tabs.find((t) => paneIds(t.tree).includes(paneId))
    if (tab) this.focusPane(tab.id, paneId, true)
  },
  activePane: () => activeTabOf()?.activePane ?? null,
  hasPane: (paneId: string) => state.tabs.some((t) => paneIds(t.tree).includes(paneId)),
  selectTab(index: number) {
    const tab = state.tabs[index]
    if (tab) set({ tabs: state.tabs, activeTab: tab.id }, true)
  },
  // Ferme le volet actif et termine son PTY ; l'onglet disparaît avec son dernier volet.
  closeActivePane() {
    const tab = activeTabOf()
    if (!tab) return
    if (!state.created.delete(tab.activePane))
      void window.wu.invoke('terminal:kill', { id: tab.activePane }).catch(console.error)
    restored.delete(tab.activePane)
    const tree = closePane(tab.tree, tab.activePane)
    if (!tree) {
      const tabs = state.tabs.filter((t) => t.id !== tab.id)
      set({ tabs, activeTab: tabs.at(-1)?.id ?? null })
      return
    }
    const updated = { ...tab, tree, activePane: paneIds(tree)[0] ?? '' }
    set({ tabs: state.tabs.map((t) => (t.id === tab.id ? updated : t)), activeTab: tab.id })
  },
  activeCwd: () => activeTabOf()?.cwd ?? null,
}
