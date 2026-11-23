import { useEffect, useState } from 'react'
import type { AppInfo } from '../shared/ipc'
import { ProjectsPanel } from './modules/projects/ProjectsPanel'
import { AgentOverview } from './modules/agents/AgentOverview'
import { TerminalArea } from './modules/terminals/TerminalArea'

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    window.wu.invoke('app:info', {}).then(setInfo, (e: unknown) => setError(String(e)))
  }, [])
  return (
    <main>
      <h1>Workflow Ultimate</h1>
      {error ? (
        <p role="alert">Impossible de joindre le processus principal : {error}</p>
      ) : (
        <p>{info ? `v${info.version} · Electron ${info.electron} · Node ${info.node}` : 'Chargement…'}</p>
      )}
      <ProjectsPanel />
      <TerminalArea />
      <AgentOverview />
    </main>
  )
}
