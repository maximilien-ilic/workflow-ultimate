import { useEffect, useRef, useState, type FormEvent } from 'react'
import { maxAgentPromptLength, maxWorktreeBranchLength, type AgentSession } from '../../../shared/ipc'
import { useWorkspace, worktreeLabel } from '../projects/workspace'
import { requestAgentStart } from './agent-store'
import './quick-launch.css'

export function QuickLaunch() {
  const { selected } = useWorkspace()
  const activeLabel = selected
    ? `Actif · ${selected.project.name} · ${worktreeLabel(selected.worktree)}`
    : 'Aucun worktree actif'
  const [agent, setAgent] = useState<AgentSession['agent']>('claude-code')
  const [newWorktree, setNewWorktree] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const prompt = useRef<HTMLInputElement>(null)
  const created = useRef<{ branch: string; path: string; projectId: string }>(null)

  useEffect(() => {
    prompt.current?.focus()
  }, [])

  async function targetWorktree(selection: NonNullable<typeof selected>, branch: string): Promise<string> {
    if (!newWorktree) return selection.worktree.path
    const projectId = selection.project.id
    const previous = created.current
    if (previous?.branch === branch && previous.projectId === projectId) return previous.path
    const path = await window.wu.invoke('worktrees:create', { projectId, branch, create: true })
    // Conserver le worktree si seul le lancement de l'agent échoue.
    created.current = { branch, path, projectId }
    return path
  }

  async function launch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected || pending) return
    const fields = new FormData(event.currentTarget)
    const text = String(fields.get('prompt'))
    const branch = String(fields.get('branch') ?? '').trim()
    if (!text.trim() || (newWorktree && !branch)) return
    setPending(true)
    setError('')
    try {
      const cwd = await targetWorktree(selected, branch)
      await requestAgentStart(crypto.randomUUID(), cwd, agent, text)
    } catch (cause) {
      setError((cause as Error).message)
      setPending(false)
    }
  }

  return (
    <form
      className="quick-launch"
      aria-label="Lancement rapide"
      onSubmit={(event) => void launch(event)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) window.close()
      }}
    >
      <label>
        Prompt
        <input name="prompt" ref={prompt} required maxLength={maxAgentPromptLength} />
      </label>
      <div className="quick-launch-options">
        <label>
          Agent
          <select
            value={agent}
            onChange={(event) => setAgent(event.target.value === 'codex' ? 'codex' : 'claude-code')}
          >
            <option value="claude-code">Claude Code</option>
            <option value="codex">Codex</option>
          </select>
        </label>
        <label>
          Worktree
          <select
            value={newWorktree ? 'new' : 'active'}
            onChange={(event) => setNewWorktree(event.target.value === 'new')}
          >
            <option value="active">{activeLabel}</option>
            <option value="new">Nouveau worktree</option>
          </select>
        </label>
      </div>
      {newWorktree && (
        <label>
          Nom de la branche
          <input name="branch" required maxLength={maxWorktreeBranchLength} />
        </label>
      )}
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={!selected || pending}>
        {pending ? 'Lancement…' : 'Lancer'}
      </button>
    </form>
  )
}
