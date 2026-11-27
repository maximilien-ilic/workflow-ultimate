import { lazy, Suspense, useEffect, useSyncExternalStore } from 'react'
import { AgentHeader } from '../agents/AgentHeader'
import { agentStore, stateLabel } from '../agents/agent-store'
import { paneIds } from './pane-tree'
import type { PaneTree } from './pane-tree'
import { terminalStore, type Tab } from './terminal-store'
import './terminals.css'

const TerminalView = lazy(() => import('./TerminalView').then(({ TerminalView }) => ({ default: TerminalView })))

function Panes({
  tab,
  tree,
  visible,
  focusRequest,
}: {
  tab: Tab
  tree: PaneTree
  visible: boolean
  focusRequest: number
}) {
  if (tree.type === 'split')
    return (
      <div className="terminal-split" data-dir={tree.dir}>
        <Panes tab={tab} tree={tree.a} visible={visible} focusRequest={focusRequest} />
        <Panes tab={tab} tree={tree.b} visible={visible} focusRequest={focusRequest} />
      </div>
    )
  return (
    <TerminalView
      key={tree.id}
      id={tree.id}
      cwd={tab.cwd}
      active={visible && tab.activePane === tree.id}
      focusRequest={focusRequest}
      onFocus={() => terminalStore.focusPane(tab.id, tree.id)}
    />
  )
}

// Titre d'onglet : état de l'agent (icône + texte pour les lecteurs d'écran), s'il y en a un.
function tabTitle(tab: Tab) {
  const state = paneIds(tab.tree)
    .map((id) => agentStore.stateOf(id))
    .find(Boolean)
  if (!state) return tab.title
  const { icon, text } = stateLabel[state]
  return (
    <>
      <span aria-hidden="true">{icon}</span> {tab.title} <span className="visually-hidden">({text})</span>
    </>
  )
}

export function TerminalArea() {
  const { tabs, activeTab, focusRequest } = useSyncExternalStore(terminalStore.subscribe, terminalStore.get)
  useSyncExternalStore(agentStore.subscribe, agentStore.version) // re-rendu quand un agent change d'état

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const ctrlShift = e.ctrlKey && e.shiftKey && !e.altKey
      const actions: Record<string, () => void> = {
        KeyD: () => terminalStore.split('row'),
        KeyE: () => terminalStore.split('column'),
        KeyW: () => terminalStore.closeActivePane(),
        KeyT: () => {
          const cwd = terminalStore.activeCwd()
          if (cwd) terminalStore.openTab(cwd, cwd.split('/').at(-1) ?? cwd)
        },
      }
      const action = ctrlShift ? actions[e.code] : undefined
      if (action) {
        e.preventDefault()
        action()
      } else if (e.altKey && !e.ctrlKey && /^Digit[1-9]$/.test(e.code)) {
        e.preventDefault()
        terminalStore.selectTab(Number(e.code.at(-1)) - 1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  if (tabs.length === 0) return <p className="terminal-empty">Aucun terminal ouvert.</p>
  return (
    <section className="terminal-area" aria-label="Terminaux">
      <div role="tablist" aria-label="Onglets de terminaux">
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={tab.id === activeTab}
            onClick={() => terminalStore.selectTab(i)}
          >
            {tabTitle(tab)}
          </button>
        ))}
      </div>
      {/* Les onglets inactifs restent montés (masqués) : leurs terminaux continuent d'afficher la sortie. */}
      {tabs.map((tab) => (
        <div key={tab.id} role="tabpanel" className="terminal-tab" hidden={tab.id !== activeTab}>
          {agentStore.get(tab.activePane) && (
            <AgentHeader terminalId={tab.activePane} info={agentStore.get(tab.activePane)!} cwd={tab.cwd} />
          )}
          <Suspense fallback={null}>
            <Panes tab={tab} tree={tab.tree} visible={tab.id === activeTab} focusRequest={focusRequest} />
          </Suspense>
        </div>
      ))}
    </section>
  )
}
