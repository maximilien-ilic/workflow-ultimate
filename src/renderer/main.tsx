import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { startTerminalHistory } from './modules/terminals/terminal-history'
import { restoreTerminalWorkspace } from './modules/terminals/terminal-store'

const root = document.getElementById('root')
if (!root) throw new Error('#root introuvable dans index.html')
startTerminalHistory()
void restoreTerminalWorkspace().then(() => {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
