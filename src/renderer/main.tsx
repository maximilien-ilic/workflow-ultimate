import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { QuickLaunch } from './modules/agents/QuickLaunch'
import { initializeTheme } from './modules/shell/app-theme'
import './modules/shell/design.css'
import { KdeTheme } from './modules/shell/KdeTheme'
import { attachQuickAgent } from './modules/agents/agent-store'
import { startTerminalHistory } from './modules/terminals/terminal-history'
import { restoreTerminalWorkspace } from './modules/terminals/terminal-store'

initializeTheme()

const root = document.getElementById('root')
if (!root) throw new Error('#root introuvable dans index.html')
const renderer = createRoot(root)
if (window.location.hash === '#quick-launch') {
  renderer.render(
    <StrictMode>
      <KdeTheme />
      <QuickLaunch />
    </StrictMode>,
  )
} else {
  startTerminalHistory()
  const terminalWorkspace = restoreTerminalWorkspace()
  // Attendre la disposition restaurée avant d'y ajouter l'onglet d'un lancement rapide.
  window.wu.onQuickAgentStarted((session) => void terminalWorkspace.then(() => attachQuickAgent(session)))
  void terminalWorkspace.then(() => {
    renderer.render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
}
