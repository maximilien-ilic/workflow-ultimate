import { useEffect, useState } from 'react'
import type { AppInfo } from '../shared/ipc'
import { ProjectSidebar } from './modules/projects/ProjectSidebar'
import { OrcaImportDialog } from './modules/projects/OrcaImportDialog'
import { useWorkspace } from './modules/projects/workspace'
import { ShellLayout } from './modules/shell/ShellLayout'
import { AgentOverview } from './modules/agents/AgentOverview'
import { PullRequestPanel } from './modules/review/PullRequestPanel'
import { ReviewView } from './modules/review/ReviewView'
import { TerminalArea } from './modules/terminals/TerminalArea'
import { ProjectPicker } from './modules/projects/ProjectPicker'
import { TaskBoard } from './modules/orchestration/TaskBoard'

export function App() {
  const workspace = useWorkspace()
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    window.wu.invoke('app:info', {}).then(setInfo, (e: unknown) => setError(String(e)))
  }, [])
  const { refresh } = workspace
  useEffect(() => window.wu.onTaskAgentStarted(() => void refresh()), [refresh])
  const selection = workspace.selected
  return (
    <ShellLayout
      leftPanel={<ProjectSidebar workspace={workspace} />}
      rightPanel={selection && (
        <PullRequestPanel
          key={`${selection.project.id}:${selection.worktree.path}`}
          projectId={selection.project.id}
          worktreePath={selection.worktree.path}
          branch={selection.worktree.branch}
        />
      )}
    >
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
        <TaskBoard key={selection?.project.id} projectId={selection?.project.id} />
        <ReviewView projectId={selection?.project.id} worktreePath={selection?.worktree.path} />
        <OrcaImportDialog select={workspace.select} refresh={workspace.refresh} />
      </main>
    </ShellLayout>
  )
}
