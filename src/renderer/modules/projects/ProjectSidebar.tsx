import { useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent } from 'react'
import type { AgentSession, PickResult, Project } from '../../../shared/ipc'
import { startAgent } from '../agents/agent-store'
import { terminalStore } from '../terminals/terminal-store'
import { worktreeLabel, type Workspace, type WorktreeSelection } from './workspace'
import './project-sidebar.css'

type Row = { key: string; project: Project; worktree?: WorktreeSelection['worktree'] }

function statusText(status: WorktreeSelection['worktree']['status']): string {
  if (!status) return 'État Git indisponible'
  const counts = [
    status.modified && `${status.modified} modifié${status.modified > 1 ? 's' : ''}`,
    status.staged && `${status.staged} indexé${status.staged > 1 ? 's' : ''}`,
    status.untracked && `${status.untracked} non suivi${status.untracked > 1 ? 's' : ''}`,
  ].filter(Boolean)
  const upstream = status.ahead === null ? '' : ` · ↑${status.ahead} ↓${status.behind}`
  return `${counts.join(', ') || 'Propre'}${upstream}`
}

export function ProjectSidebar({ workspace }: { workspace: Workspace }) {
  const { groups, selected, select, refresh, error, collapsed, expand } = workspace
  const [focusKey, setFocusKey] = useState<string>()
  const [messages, setMessages] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [removal, setRemoval] = useState<{ target: WorktreeSelection; files: number }>()
  const confirmation = useRef<HTMLDialogElement>(null)
  const rows: Row[] = groups.flatMap(({ project, worktrees }) => [
    { key: project.id, project },
    ...(collapsed.has(project.id)
      ? []
      : worktrees.map((worktree) => ({ key: worktree.path, project, worktree }))),
  ])
  const tabStop = rows.some(({ key }) => key === focusKey) ? focusKey : rows[0]?.key
  const label =
    selected && (selected.worktree.main ? selected.project.name : worktreeLabel(selected.worktree))

  async function run(action: () => Promise<unknown>) {
    setMessages([])
    setBusy(true)
    try {
      await action()
    } catch (cause) {
      setMessages([String(cause)])
    } finally {
      setBusy(false)
    }
  }

  async function report(result: PickResult) {
    setMessages(result.rejected.map(({ path, reason }) => `${path} : ${reason}`))
    await refresh()
  }

  function onDrop(event: DragEvent) {
    event.preventDefault()
    const paths = [...event.dataTransfer.files].map((file) => window.wu.pathForFile(file)).filter(Boolean)
    void run(async () => {
      const results = await Promise.allSettled(
        paths.map((path) => window.wu.invoke('projects:add', { path })),
      )
      const rejected = results.flatMap((result, index) =>
        result.status === 'rejected' ? [{ path: paths[index] ?? '', reason: String(result.reason) }] : [],
      )
      await report({ added: [], rejected })
    })
  }

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (!(event.target instanceof HTMLElement)) return
    const focusedKey = event.target.getAttribute('data-tree-key')
    const index = rows.findIndex(({ key }) => key === focusedKey)
    const current = rows[index]
    if (!current) return

    let target: Row | undefined
    switch (event.key) {
      case 'ArrowDown':
        target = rows[index + 1]
        break
      case 'ArrowUp':
        target = rows[index - 1]
        break
      case 'Home':
        target = rows[0]
        break
      case 'End':
        target = rows.at(-1)
        break
      case 'ArrowRight':
        if (!current.worktree) {
          if (collapsed.has(current.project.id)) expand(current.project.id, true)
          else if (rows[index + 1]?.worktree) target = rows[index + 1]
        }
        break
      case 'ArrowLeft':
        if (current.worktree) target = rows.find(({ key }) => key === current.project.id)
        else expand(current.project.id, false)
        break
      default:
        return
    }
    event.preventDefault()
    if (target)
      event.currentTarget.querySelector<HTMLElement>(`[data-tree-key="${CSS.escape(target.key)}"]`)?.focus()
  }

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected) return
    const form = new FormData(event.currentTarget)
    const projectId = selected.project.id
    void run(async () => {
      const branch = String(form.get('branch') ?? '').trim()
      const path = await window.wu.invoke('worktrees:create', {
        projectId,
        branch,
        create: form.has('create'),
      })
      expand(projectId, true)
      select(path)
      setCreating(false)
      await refresh()
    })
  }

  function remove(target: WorktreeSelection, force: boolean) {
    void run(async () => {
      const result = await window.wu.invoke('worktrees:remove', {
        projectId: target.project.id,
        path: target.worktree.path,
        force,
      })
      if (result.removed) {
        confirmation.current?.close()
        await refresh()
      } else {
        setRemoval({ target, files: result.dirtyFiles })
        confirmation.current?.showModal()
      }
    })
  }

  function removeProject(project: Project) {
    void run(async () => {
      await window.wu.invoke('projects:remove', { id: project.id })
      await refresh()
    })
  }

  function launch(agent: AgentSession['agent'], name: string) {
    if (!selected || !label) return
    const cwd = selected.worktree.path
    const title = `${name} · ${label}`
    void run(async () => {
      const id = await startAgent(cwd, title, { agent })
      terminalStore.openAttachedTab(cwd, title, id)
      await refresh()
    })
  }

  return (
    <section aria-label="Projets" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
      <h2>Projets</h2>
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          void run(async () => report(await window.wu.invoke('projects:pick', { mode: 'repo' })))
        }
      >
        Ajouter un dépôt…
      </button>{' '}
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          void run(async () => report(await window.wu.invoke('projects:pick', { mode: 'scan' })))
        }
      >
        Scanner un dossier…
      </button>
      <p>Ou déposez un dossier ici.</p>
      {(error || messages.length > 0) && (
        <div role="alert">
          {error}
          {messages.map((message) => (
            <div key={message}>{message}</div>
          ))}
        </div>
      )}
      <div role="tree" aria-label="Projets et worktrees" className="project-tree" onKeyDown={navigate}>
        {rows.map(({ key, project, worktree }) => (
          <button
            key={key}
            type="button"
            role="treeitem"
            data-tree-key={key}
            tabIndex={key === tabStop ? 0 : -1}
            aria-level={worktree ? 2 : 1}
            aria-label={worktree ? worktreeLabel(worktree) : project.name}
            aria-expanded={worktree ? undefined : !collapsed.has(project.id)}
            aria-selected={worktree ? worktree.path === selected?.worktree.path : undefined}
            title={worktree?.path ?? project.path}
            onFocus={() => setFocusKey(key)}
            onClick={() => (worktree ? select(worktree.path) : expand(project.id, collapsed.has(project.id)))}
          >
            {worktree ? (
              <>
                <span>{worktreeLabel(worktree)}</span> <small>{statusText(worktree.status)}</small>
              </>
            ) : (
              <strong>
                {collapsed.has(project.id) ? '▸' : '▾'} {project.name}
              </strong>
            )}
          </button>
        ))}
      </div>
      {!rows.length && <p>Aucun projet.</p>}
      {groups.map(
        ({ project, worktrees, error }) =>
          worktrees.length === 0 && (
            <div key={project.id}>
              {error && (
                <p role="alert">
                  {project.name} · {error}
                </p>
              )}
              <button type="button" disabled={busy} onClick={() => removeProject(project)}>
                Retirer {project.name}
              </button>
            </div>
          ),
      )}
      {selected && label && (
        <div className="project-actions" aria-label={`Actions pour ${label}`}>
          <button
            type="button"
            aria-label={`Terminal dans ${label}`}
            onClick={() => {
              terminalStore.openTab(selected.worktree.path, label)
              void refresh()
            }}
          >
            Terminal
          </button>
          <button
            type="button"
            disabled={busy}
            aria-label={`Claude dans ${label}`}
            onClick={() => launch('claude-code', 'Claude')}
          >
            Claude
          </button>
          <button
            type="button"
            disabled={busy}
            aria-label={`Codex dans ${label}`}
            onClick={() => launch('codex', 'Codex')}
          >
            Codex
          </button>
          <button
            type="button"
            disabled={busy}
            aria-expanded={creating}
            onClick={() => setCreating(!creating)}
          >
            Créer un worktree…
          </button>
          {!selected.worktree.main && (
            <button type="button" disabled={busy} onClick={() => remove(selected, false)}>
              Supprimer le worktree
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            aria-label={`Retirer ${selected.project.name}`}
            onClick={() => removeProject(selected.project)}
          >
            Retirer le projet
          </button>
          {creating && (
            <form onSubmit={create}>
              <label>
                Branche <input name="branch" required maxLength={200} />
              </label>
              <label>
                <input type="checkbox" name="create" defaultChecked /> Créer la branche
              </label>
              <button type="submit" disabled={busy}>
                Créer
              </button>
            </form>
          )}
        </div>
      )}
      <dialog ref={confirmation} aria-label="Supprimer le worktree">
        <p>{removal?.files} fichier(s) avec des changements seront perdus.</p>
        {messages.length > 0 && <p role="alert">{messages.join('\n')}</p>}
        <button type="button" onClick={() => confirmation.current?.close()}>
          Annuler
        </button>{' '}
        <button type="button" disabled={busy} onClick={() => removal && remove(removal.target, true)}>
          Supprimer et perdre les modifications
        </button>
      </dialog>
    </section>
  )
}
