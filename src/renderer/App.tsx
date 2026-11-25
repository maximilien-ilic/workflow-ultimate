import { useEffect, useState } from 'react'
import type { AppInfo } from '../shared/ipc'
import { ProjectSidebar } from './modules/projects/ProjectSidebar'
import { OrcaImportDialog } from './modules/projects/OrcaImportDialog'
import { useWorkspace } from './modules/projects/workspace'
import { ShellLayout } from './modules/shell/ShellLayout'
import { AgentOverview } from './modules/agents/AgentOverview'
import { ReviewView } from './modules/review/ReviewView'
import { TerminalArea } from './modules/terminals/TerminalArea'
import { ProjectPicker } from './modules/projects/ProjectPicker'

export function App() {
  const workspace = useWorkspace()
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    window.wu.invoke('app:info', {}).then(setInfo, (e: unknown) => setError(String(e)))
  }, [])
  return (
    <ShellLayout leftPanel={<ProjectSidebar workspace={workspace} />}>
      <ProjectPicker workspace={workspace} />
      <main>
        <h1>Workflow Ultimate</h1>
        {error ? (
          <p role="alert">Impossible de joindre le processus principal : {error}</p>
        ) : (
          <p>{info ? `v${info.version} · Electron ${info.electron} · Node ${info.node}` : 'Chargement…'}</p>
        )}
        <TerminalArea />
        <AgentOverview />
        <ReviewView />
        <OrcaImportDialog select={workspace.select} refresh={workspace.refresh} />
      </main>
    </ShellLayout>
  )
}
