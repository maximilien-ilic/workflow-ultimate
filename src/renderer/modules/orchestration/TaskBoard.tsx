import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { taskStatuses, type Task, type TaskStatus } from '../../../shared/ipc'
import { registerCommand } from '../palette/commands'
import './task-board.css'

type Draft = Pick<Task, 'title' | 'body'>
type SaveDraft = (draft: Draft) => Promise<boolean>
type Direction = -1 | 1
type Move = { id: number; direction: Direction }

const columnTitles: Record<TaskStatus, string> = {
  todo: 'À faire',
  doing: 'En cours',
  review: 'En revue',
  done: 'Fini',
}

const neighbour = (status: TaskStatus, direction: Direction): TaskStatus | undefined =>
  taskStatuses[taskStatuses.indexOf(status) + direction]

function TaskForm({ task, onSave, onClose }: { task?: Task; onSave: SaveDraft; onClose?: (restoreFocus: boolean) => void }) {
  const [title, setTitle] = useState(task?.title ?? '')
  const [body, setBody] = useState(task?.body ?? '')
  const [saving, setSaving] = useState(false)
  const submitting = useRef(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    // Le ref bloque aussi deux soumissions avant le prochain rendu.
    if (submitting.current) return
    submitting.current = true
    setSaving(true)
    try {
      if (await onSave({ title, body })) {
        if (onClose) onClose(form.contains(document.activeElement))
        else setTitle('')
      }
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }

  function cancel() {
    if (!submitting.current) onClose?.(true)
  }

  return (
    <form onSubmit={submit}>
      <input aria-label={task ? 'Titre de la tâche' : 'Nouvelle tâche'} value={title}
        onChange={(e) => setTitle(e.target.value)} autoFocus={Boolean(task)} readOnly={saving} required />
      {task && <textarea aria-label="Description de la tâche" value={body} onChange={(e) => setBody(e.target.value)} readOnly={saving} />}
      <button type="submit" aria-disabled={saving}>{task ? 'Enregistrer' : 'Ajouter'}</button>
      {onClose && <button type="button" aria-disabled={saving} onClick={cancel}>Annuler</button>}
    </form>
  )
}

type CardProps = { task: Task; lastMove: Move | null; onMove: (direction: Direction) => void; onSave: SaveDraft }

function TaskCard({ task, lastMove, onMove, onSave }: CardProps) {
  const [editing, setEditing] = useState(false)
  const [editorCloseFocus, setEditorCloseFocus] = useState<boolean | null>(null)
  const closeEditor = (restoreFocus: boolean) => {
    setEditing(false)
    setEditorCloseFocus(restoreFocus)
  }
  if (editing)
    return <TaskForm task={task} onClose={closeEditor} onSave={onSave} />
  // Une carte déplacée privilégie le même sens, puis « Éditer » au bord du tableau.
  // À la fermeture de l'éditeur, « Éditer » récupère le focus s'il était encore dans le formulaire.
  const lastDirection = lastMove?.id === task.id ? lastMove.direction : null
  const moved = editorCloseFocus === null && lastDirection && neighbour(task.status, lastDirection) ? lastDirection : null
  const focusEdit = editorCloseFocus ?? (lastDirection !== null && moved === null)
  const moveButton = (direction: Direction) => {
    const target = neighbour(task.status, direction)
    if (!target) return null
    return (
      <button type="button" autoFocus={moved === direction} onClick={() => onMove(direction)}
        aria-label={`Déplacer « ${task.title} » vers ${columnTitles[target]}`}>
        {direction < 0 ? '←' : '→'}
      </button>
    )
  }
  return (
    <li>
      {task.issueNumber && <span>#{task.issueNumber} </span>}
      <strong>{task.title}</strong>
      {task.body && <p>{task.body}</p>}
      {moveButton(-1)}
      <button type="button" autoFocus={focusEdit} onClick={() => setEditing(true)} aria-label={`Éditer « ${task.title} »`}>Éditer</button>
      {moveButton(1)}
    </li>
  )
}

// Tableau de tâches du projet sélectionné (Ctrl+Shift+K). Le parent le recrée à chaque changement de projet.
export function TaskBoard({ projectId }: { projectId: string | undefined }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [error, setError] = useState('')
  const [lastMove, setLastMove] = useState<Move | null>(null)

  const [importing, setImporting] = useState(false)

  const apply = useCallback(async (request: Promise<Task[]>) => {
    setError('')
    try {
      setTasks(await request)
      return true
    } catch (reason) {
      setError(String(reason))
      return false
    }
  }, [])
  const importIssues = useCallback((id: string) => {
    setImporting(true)
    void apply(window.wu.invoke('tasks:importIssues', { projectId: id })).finally(() => setImporting(false))
  }, [apply])

  useEffect(() => {
    const showBoard = (load: (id: string) => void) => {
      if (!dialog.current?.open) dialog.current?.showModal()
      if (projectId) load(projectId)
    }
    const removeBoard = registerCommand({
      id: 'orchestration.tasks',
      title: 'Tableau de tâches',
      keybinding: 'Ctrl+Shift+K',
      run: () => showBoard((id) => void apply(window.wu.invoke('tasks:list', { projectId: id }))),
    })
    const removeImport = registerCommand({
      id: 'orchestration.import-issues',
      title: 'Importer les issues GitHub',
      run: () => showBoard(importIssues),
    })
    return () => {
      removeBoard()
      removeImport()
    }
  }, [projectId, apply, importIssues])

  const move = (task: Task, direction: Direction) => {
    const status = neighbour(task.status, direction)
    if (!projectId || !status) return
    setLastMove({ id: task.id, direction })
    void apply(window.wu.invoke('tasks:move', { projectId, id: task.id, status }))
  }

  return (
    <dialog ref={dialog} aria-label="Tableau de tâches">
      <h2>Tâches</h2>
      {!projectId && <p>Aucun projet sélectionné.</p>}
      {projectId && <TaskForm onSave={(draft) => apply(window.wu.invoke('tasks:create', { projectId, ...draft }))} />}
      {projectId && (
        <button type="button" onClick={() => importIssues(projectId)} disabled={importing}>
          Importer les issues GitHub
        </button>
      )}
      <p role="status">{importing ? 'Import des issues…' : ''}</p>
      {error && <p role="alert">{error}</p>}
      {projectId && <div className="task-board-columns">{taskStatuses.map((status) => (
        <section key={status} aria-label={columnTitles[status]}>
          <h3>{columnTitles[status]}</h3>
          <ul>
            {tasks.filter((task) => task.status === status).map((task) => (
              <TaskCard key={task.id} task={task} lastMove={lastMove} onMove={(direction) => move(task, direction)}
                onSave={(draft) => apply(window.wu.invoke('tasks:update', { projectId, id: task.id, ...draft }))} />
            ))}
          </ul>
        </section>
      ))}</div>}
      <button type="button" onClick={() => dialog.current?.close()}>Fermer</button>
    </dialog>
  )
}
