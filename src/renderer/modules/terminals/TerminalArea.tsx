import { useEffect, useSyncExternalStore } from 'react'
import type { PaneTree } from './pane-tree'
import { terminalStore, type Tab } from './terminal-store'
import { TerminalView } from './TerminalView'
import './terminals.css'

function Panes({ tab, tree }: { tab: Tab; tree: PaneTree }) {
  if (tree.type === 'split')
    return (
      <div className="terminal-split" data-dir={tree.dir}>
        <Panes tab={tab} tree={tree.a} />
        <Panes tab={tab} tree={tree.b} />
      </div>
    )
  return (
    <TerminalView
      key={tree.id}
      id={tree.id}
      cwd={tab.cwd}
      active={tab.activePane === tree.id}
      onFocus={() => terminalStore.focusPane(tab.id, tree.id)}
    />
  )
}

export function TerminalArea() {
  const { tabs, activeTab } = useSyncExternalStore(terminalStore.subscribe, terminalStore.get)

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
            {tab.title}
          </button>
        ))}
      </div>
      {/* Les onglets inactifs restent montés (masqués) : leurs terminaux continuent d'afficher la sortie. */}
      {tabs.map((tab) => (
        <div key={tab.id} role="tabpanel" className="terminal-tab" hidden={tab.id !== activeTab}>
          <Panes tab={tab} tree={tab.tree} />
        </div>
      ))}
    </section>
  )
}
