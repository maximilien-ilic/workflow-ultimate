import { closePane, paneIds, splitPane, type PaneTree } from './pane-tree'

export type Tab = { id: string; title: string; cwd: string; tree: PaneTree; activePane: string }
type State = { tabs: Tab[]; activeTab: string | null; created: Set<string> }

// sessionStorage survit à un rechargement du renderer (pas à un redémarrage de l'appli) : après un
// rechargement, les onglets se reconnectent à leurs PTY, toujours vivants dans le pty-host.
// shortcut: la restauration après redémarrage de l'appli arrive avec #15
const KEY = 'wu.terminals'

function load(): State {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as Omit<State, 'created'> | null
    if (saved && Array.isArray(saved.tabs)) return { ...saved, created: new Set() }
  } catch {
    // stockage indisponible ou illisible : on repart de zéro
  }
  return { tabs: [], activeTab: null, created: new Set() }
}

let state = load()
const listeners = new Set<() => void>()

function set(next: Omit<State, 'created'>) {
  state = { ...next, created: state.created }
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ tabs: state.tabs, activeTab: state.activeTab }))
  } catch {
    // sans stockage, on perd seulement la reconnexion après rechargement
  }
  listeners.forEach((l) => l())
}

const activeTabOf = () => state.tabs.find((t) => t.id === state.activeTab)

export const terminalStore = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  get: () => state,
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
  focusPane(tabId: string, paneId: string) {
    set({
      tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, activePane: paneId } : t)),
      activeTab: tabId,
    })
  },
  // Affiche l'onglet qui contient ce volet et le rend actif (vue d'ensemble, agent suivant en attente).
  showPane(paneId: string) {
    const tab = state.tabs.find((t) => paneIds(t.tree).includes(paneId))
    if (tab) this.focusPane(tab.id, paneId)
  },
  activePane: () => activeTabOf()?.activePane ?? null,
  selectTab(index: number) {
    const tab = state.tabs[index]
    if (tab) set({ tabs: state.tabs, activeTab: tab.id })
  },
  // Ferme le volet actif et termine son PTY ; l'onglet disparaît avec son dernier volet.
  closeActivePane() {
    const tab = activeTabOf()
    if (!tab) return
    void window.wu.invoke('terminal:kill', { id: tab.activePane })
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
