import { useCallback, useEffect, useState, type DragEvent } from 'react'
import type { PickResult, Project } from '../../../shared/ipc'

// shortcut: panneau sans style ni barre latérale ; la disposition (#8) et la barre latérale (#11) le remplaceront
export function ProjectsPanel() {
  const [projects, setProjects] = useState<Project[]>([])
  const [messages, setMessages] = useState<string[]>([])

  const refresh = useCallback(() => window.wu.invoke('projects:list', {}).then(setProjects), [])
  useEffect(() => {
    refresh().catch((e: unknown) => setMessages([String(e)]))
  }, [refresh])

  const report = (result: PickResult) => {
    setMessages(result.rejected.map((r) => `${r.path} : ${r.reason}`))
    return refresh()
  }
  const run = (task: Promise<unknown>) => task.catch((e: unknown) => setMessages([String(e)]))

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    const paths = [...event.dataTransfer.files].map((f) => window.wu.pathForFile(f)).filter(Boolean)
    run(
      Promise.allSettled(paths.map((path) => window.wu.invoke('projects:add', { path }))).then((results) =>
        report({
          added: [],
          rejected: results.flatMap((r, i) =>
            r.status === 'rejected' ? [{ path: paths[i] ?? '', reason: String(r.reason) }] : [],
          ),
        }),
      ),
    )
  }

  return (
    <section aria-label="Projets" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <h2>Projets</h2>
      <button onClick={() => run(window.wu.invoke('projects:pick', { mode: 'repo' }).then(report))}>
        Ajouter un dépôt…
      </button>{' '}
      <button onClick={() => run(window.wu.invoke('projects:pick', { mode: 'scan' }).then(report))}>
        Scanner un dossier…
      </button>
      <p>Ou déposez un dossier ici.</p>
      {messages.length > 0 && (
        <ul role="alert">
          {messages.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      {projects.length === 0 ? (
        <p>Aucun projet.</p>
      ) : (
        <ul aria-label="Liste des projets">
          {projects.map((p) => (
            <li key={p.id}>
              <strong>{p.name}</strong> <small>{p.path}</small>{' '}
              <button
                aria-label={`Retirer ${p.name}`}
                onClick={() => run(window.wu.invoke('projects:remove', { id: p.id }).then(refresh))}
              >
                Retirer
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
