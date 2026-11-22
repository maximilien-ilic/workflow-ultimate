import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ShellLayout } from './modules/shell/ShellLayout'

const root = document.getElementById('root')
if (!root) throw new Error('#root introuvable dans index.html')
createRoot(root).render(
  <StrictMode>
    <ShellLayout>
      <App />
    </ShellLayout>
  </StrictMode>,
)
