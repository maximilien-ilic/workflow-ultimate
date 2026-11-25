import { useEffect, useRef, useState, type FormEvent } from 'react'
import { taskStatuses, type Task, type TaskStatus } from '../../../shared/ipc'
import { registerCommand } from '../palette/commands'

type Draft = Pick<Task, 'title' | 'body'>
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

function TaskEditor({ task, onSave, onCancel }: { task: Task; onSave: (draft: Draft) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(task.title)
  const [body, setBody] = useState(task.body)
  function submit(event: FormEvent) {
    event.preventDefault()
    onSave({ title, body })
  }
  return (
    <form onSubmit={submit}>
      <input aria-label="Titre de la tâche" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required />
      <textarea aria-label="Description de la tâche" value={body} onChange={(e) => setBody(e.target.value)} />
      <button type="submit">Enregistrer</button> <button type="button" onClick={onCancel}>Annuler</button>
    </form>
  )
}

type CardProps = { task: Task; lastMove: Move | null; onMove: (direction: Direction) => void; onSave: (draft: Draft) => void }

function TaskCard({ task, lastMove, onMove, onSave }: CardProps) {
  const [editing, setEditing] = useState(false)
  if (editing)
    return <TaskEditor task={task} onCancel={() => setEditing(false)} onSave={(draft) => { setEditing(false); onSave(draft) }} />
  // Le déplacement recrée la carte dans une autre colonne : on y remet le focus pour enchaîner au clavier.
  const moved = lastMove?.id === task.id ? lastMove.direction : null
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
      <strong>{task.title}</strong>
      {task.body && <p>{task.body}</p>}
      {moveButton(-1)}
      <button type="button" onClick={() => setEditing(true)} aria-label={`Éditer « ${task.title} »`}>Éditer</button>
      {moveButton(1)}
    </li>
  )
}

function NewTaskForm({ onCreate }: { onCreate: (draft: Draft) => void }) {
  const [title, setTitle] = useState('')
  function submit(event: FormEvent) {
    event.preventDefault()
    onCreate({ title, body: '' })
    setTitle('')
  }
  return (
    <form onSubmit={submit}>
      <input aria-label="Nouvelle tâche" value={title} onChange={(e) => setTitle(e.target.value)} required />
      <button type="submit">Ajouter</button>
    </form>
  )
}

// Tableau de tâches du projet sélectionné (Ctrl+Shift+K). Le parent le recrée à chaque changement de projet.
export function TaskBoard({ projectId }: { projectId: string | undefined }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [error, setError] = useState('')
  const [lastMove, setLastMove] = useState<Move | null>(null)

  const apply = (request: Promise<Task[]>) => {
    setError('')
    request.then(setTasks, (reason: unknown) => setError(String(reason)))
  }

  useEffect(
    () =>
      registerCommand({
        id: 'orchestration.tasks',
        title: 'Tableau de tâches',
        keybinding: 'Ctrl+Shift+K',
        run() {
          dialog.current?.showModal()
          if (projectId) apply(window.wu.invoke('tasks:list', { projectId }))
        },
      }),
    [projectId],
  )

  const move = (task: Task, direction: Direction) => {
    const status = neighbour(task.status, direction)
    if (!projectId || !status) return
    setLastMove({ id: task.id, direction })
    apply(window.wu.invoke('tasks:move', { projectId, id: task.id, status }))
  }

  return (
    <dialog ref={dialog} aria-label="Tableau de tâches">
      <h2>Tâches</h2>
      {!projectId && <p>Aucun projet sélectionné.</p>}
      {projectId && <NewTaskForm onCreate={(draft) => apply(window.wu.invoke('tasks:create', { projectId, ...draft }))} />}
      {error && <p role="alert">{error}</p>}
      {projectId && taskStatuses.map((status) => (
        <section key={status} aria-label={columnTitles[status]}>
          <h3>{columnTitles[status]}</h3>
          <ul>
            {tasks.filter((task) => task.status === status).map((task) => (
              <TaskCard key={task.id} task={task} lastMove={lastMove} onMove={(direction) => move(task, direction)}
                onSave={(draft) => apply(window.wu.invoke('tasks:update', { projectId, id: task.id, ...draft }))} />
            ))}
          </ul>
        </section>
      ))}
      <button type="button" onClick={() => dialog.current?.close()}>Fermer</button>
    </dialog>
  )
}
